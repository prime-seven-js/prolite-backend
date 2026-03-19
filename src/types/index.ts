import { SupabaseClient } from "@supabase/supabase-js";

// Khai báo kiểu dữ liệu cho Payload của JWT
export interface JWTPayload {
  userId: string;
  email: string;
  username: string;
  role: string;
  exp: number;
}

// Khai báo kiểu cho Bindings (biến môi trường Cloudflare Workers)
export type AppBindings = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  JWT_SECRET: string;
};

// Khai báo kiểu cho Variables dùng chung trong Hono
export type AppVariables = {
  supabase: SupabaseClient;
  jwtPayload: JWTPayload;
};

// Kiểu Hono Environment dùng chung
export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};
