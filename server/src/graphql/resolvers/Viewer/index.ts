import crypto from "crypto";
import { Response, Request } from "express";
import { IResolvers } from "@graphql-tools/utils";
import { Google } from "../../../lib/api";
import { Database, User, Viewer } from "./../../../lib/types";
import { LogInArgs } from "./types";

const cookieOptions = {
  httpOnly: true,
  sameSite: false,
  signed: true,
  secure: false,
  withCredentials: true,
  hostOnly: true
};

async function logInViaGoogle(
  code: string,
  token: string,
  db: Database,
  res: Response
): Promise<User | null> {
  const { user } = await Google.logIn(code);

  if (!user) {
    throw new Error("Google login error");
  }

  // Names/Photos/Email Lists
  const userNamesList = user.names && user.names.length ? user.names : null;
  const userPhotosList = user.photos && user.photos.length ? user.photos : null;
  const userEmailsList =
    user.emailAddresses && user.emailAddresses.length
      ? user.emailAddresses
      : null;

  // User Display Name
  const userName = userNamesList ? userNamesList[0].displayName : null;

  // User Id
  const userId =
    userNamesList &&
    userNamesList[0].metadata &&
    userNamesList[0].metadata.source
      ? userNamesList[0].metadata.source.id
      : null;

  // User Avatar
  const userAvatar =
    userPhotosList && userPhotosList[0].url ? userPhotosList[0].url : null;

  // User Email
  const userEmail =
    userEmailsList && userEmailsList[0].value ? userEmailsList[0].value : null;

  if (!userId || !userName || !userAvatar || !userEmail) {
    throw new Error("Google login error");
  }

  const updateRes = await db.users.findOneAndUpdate(
    { _id: userId },
    {
      $set: {
        name: userName,
        avatar: userAvatar,
        contact: userEmail,
        token
      }
    },
    { returnDocument: "after" }
  );

  let viewer = updateRes.value;

  if (!viewer) {
    const insertRes = await db.users.insertOne({
      _id: userId,
      name: userName,
      avatar: userAvatar,
      contact: userEmail,
      token: token,
      bookings: [],
      income: 0,
      listings: []
    });

    viewer = await db.users.findOne({ _id: insertRes.insertedId });
  }

  console.log("userId: ", userId);

  res.cookie("viewer", userId, {
    ...cookieOptions,
    maxAge: 365 * 24 * 60 * 60 * 1000,
    domain: "localhost:3000"
  });

  console.log("response: ", res);

  return viewer;
}

async function logInViaCookie(
  token: string,
  db: Database,
  req: Request,
  res: Response
): Promise<User | null> {
  console.log("token: ", token);
  const updateReq = await db.users.findOneAndUpdate(
    { _id: req.signedCookies.viewer },
    { $set: { token } },
    { returnDocument: "after" }
  );
  const viewer = updateReq.value;
  console.log("viewer: ", viewer);

  if (!viewer) {
    res.clearCookie("viewer", cookieOptions);
  }

  return viewer;
}

export const viewerResolvers: IResolvers = {
  Query: {
    authUrl: authUrlQuery
  },
  Mutation: {
    logIn: logInMutation,
    logOut: logOutMutation
  },
  Viewer: {
    id: getViewerId,
    hasWallet: viewerHasWallet
  }
};

function authUrlQuery(): string {
  try {
    return Google.authUrl;
  } catch (err) {
    throw new Error(`Failed to query Google Auth url: ${err}`);
  }
}

async function logInMutation(
  _root: undefined,
  { input }: LogInArgs,
  { db, req, res }: { db: Database; req: Request; res: Response }
) {
  try {
    const code = input ? input.code : null;
    const token = crypto.randomBytes(16).toString("hex");

    console.log("code: ", code);

    const viewer: User | null = code
      ? await logInViaGoogle(code, token, db, res)
      : await logInViaCookie(token, db, req, res);

    if (!viewer) {
      return { didRequest: true };
    }

    return {
      _id: viewer._id,
      token: viewer.token,
      avatar: viewer.avatar,
      didRequest: true
    };
  } catch (err) {
    throw new Error(`Failed to log in: ${err}`);
  }
}

function viewerHasWallet(viewer: Viewer): boolean | undefined {
  return viewer.walletId ? true : undefined;
}

function getViewerId(viewer: Viewer): string | undefined {
  return viewer._id;
}

function logOutMutation(
  _root: undefined,
  _args: unknown,
  { res }: { res: Response }
): Viewer {
  try {
    res.clearCookie("viewer", cookieOptions);
    return { didRequest: true };
  } catch (error) {
    throw new Error(`Failed to log out: ${error}`);
  }
}