import { Hono } from "hono";
import type { AppEnv } from "./types";
import indexApp from "./index";
import likesApp from "./routes/likes";
import friendsApp from "./routes/friends";
import conversationsApp from "./routes/conversations";
import notificationsApp from "./routes/notifications";
import adminApp from "./routes/admin";

const api = new Hono<AppEnv>();

// code ha
api.route("/", indexApp);

// code tm
api.route("/", likesApp);
api.route("/", friendsApp);
api.route("/", conversationsApp);
api.route("/", notificationsApp);
api.route("/", adminApp);

export default api;
