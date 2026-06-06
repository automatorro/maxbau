import { supabase } from "@/integrations/supabase/client";

export type AiProvider = "anthropic" | "gemini";

export interface AiProxyResult {
  ok: boolean;
  status: number;
  data: any;
}

/**
 * Calls AI providers (Anthropic / Gemini) through the secure server-side
 * `ai-proxy` edge function. API keys are never exposed to the browser.
 */
export async function callAiProxy(
  provider: AiProvider,
  payload: unknown,
  model?: string
): Promise<AiProxyResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return { ok: false, status: 401, data: { error: "Not authenticated" } };
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-proxy`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ provider, payload, model }),
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data };
}
