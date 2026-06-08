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

  try {
    const { data, error } = await supabase.functions.invoke("ai-proxy", {
      body: { provider, payload, model },
    });

    if (error) {
      const status = (error as any).status || 500;
      return { ok: false, status, data: { error: error.message } };
    }

    return { ok: true, status: 200, data };
  } catch (err: any) {
    return { ok: false, status: 500, data: { error: err.message || "Unknown error" } };
  }
}
