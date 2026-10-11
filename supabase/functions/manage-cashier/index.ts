import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const cashierEmail = "karyawan@laundry.com";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Metode tidak didukung." }, { status: 405, headers: corsHeaders });
  }

  const authorization = request.headers.get("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!token || !serviceKey || !supabaseUrl) {
    return Response.json({ error: "Konfigurasi fungsi atau sesi login tidak tersedia." }, { status: 401, headers: corsHeaders });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) {
    return Response.json({ error: "Sesi login tidak valid." }, { status: 401, headers: corsHeaders });
  }

  const { data: ownerRole, error: roleError } = await admin
    .from("app_user_roles")
    .select("role")
    .eq("user_id", userResult.user.id)
    .maybeSingle();
  if (roleError) {
    return Response.json({ error: `Hak akses gagal diverifikasi: ${roleError.message}` }, { status: 500, headers: corsHeaders });
  }
  if (ownerRole?.role !== "owner") {
    return Response.json({ error: "Hanya pemilik yang dapat mengelola akun pegawai." }, { status: 403, headers: corsHeaders });
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Format permintaan tidak valid." }, { status: 400, headers: corsHeaders });
  }
  if (
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    new TextEncoder().encode(body.password).length > 72
  ) {
    return Response.json({ error: "Kata sandi harus terdiri dari 12 hingga 72 karakter." }, { status: 400, headers: corsHeaders });
  }

  const { data: existingRole, error: cashierRoleError } = await admin
    .from("app_user_roles")
    .select("user_id")
    .eq("role", "cashier")
    .maybeSingle();
  if (cashierRoleError) {
    return Response.json({ error: `Akun pegawai gagal diperiksa: ${cashierRoleError.message}` }, { status: 500, headers: corsHeaders });
  }

  if (existingRole?.user_id) {
    const { error } = await admin.auth.admin.updateUserById(existingRole.user_id, {
      password: body.password,
      user_metadata: { display_name: "Kasir Toko" },
    });
    if (error) {
      return Response.json({ error: `Kata sandi akun kasir gagal diperbarui: ${error.message}` }, { status: 400, headers: corsHeaders });
    }
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: cashierEmail,
      password: body.password,
      email_confirm: true,
      user_metadata: { display_name: "Kasir Toko" },
    });
    if (error || !created.user) {
      return Response.json({ error: `Akun kasir gagal dibuat: ${error?.message || "Pengguna tidak dikembalikan oleh Supabase."}` }, { status: 400, headers: corsHeaders });
    }
    const { error: insertRoleError } = await admin
      .from("app_user_roles")
      .insert({ user_id: created.user.id, role: "cashier" });
    if (insertRoleError) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(created.user.id);
      const cleanupMessage = deleteError ? ` Pembersihan akun sementara juga gagal: ${deleteError.message}` : "";
      return Response.json({ error: `Hak akses kasir gagal dibuat: ${insertRoleError.message}.${cleanupMessage}` }, { status: 500, headers: corsHeaders });
    }
  }

  return Response.json({ success: true }, { headers: corsHeaders });
});
