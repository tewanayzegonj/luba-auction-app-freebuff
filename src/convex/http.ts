import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { chapaWebhook, verifyChapaReturn } from "./chapaWebhook";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({
  path: "/webhooks/chapa",
  method: "POST",
  handler: chapaWebhook,
});
http.route({
  path: "/payments/chapa/verify",
  method: "POST",
  handler: verifyChapaReturn,
});

export default http;
