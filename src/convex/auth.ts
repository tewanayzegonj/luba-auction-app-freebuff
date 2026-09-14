// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { emailOtp } from "./auth/emailOtp";
import { telegramOtp } from "./auth/telegramOtp";
import { afroMessageSms } from "./auth/afroMessageSms";
import { resolveCreateOrUpdateUser } from "./auth/userResolution";


export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailOtp, telegramOtp, afroMessageSms, Anonymous],
  callbacks: {
    // Route Telegram/SMS sign-ins to linked accounts instead of creating
    // duplicates (see auth/userResolution.ts for the rules).
    createOrUpdateUser: resolveCreateOrUpdateUser,
  },
});