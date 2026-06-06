import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface AiMemoryMatch {
  id: string;
  prompt_context: string;
  ai_message: string | null;
  correction: string;
  tags: string[];
  rank: number;
}

export interface SaveCorrectionInput {
  promptContext: string;
  aiMessage?: string | null;
  correction: string;
  tags?: string[];
}

/**
 * Hook pentru sistemul de memorie AI (RAG).
 * - count: numărul de reguli active (per-companie)
 * - saveCorrection: salvează o corecție nouă
 * - searchMemory: caută corecții relevante pentru un text dat
 */
export function useAiMemory() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refreshCount = useCallback(async () => {
    const { count: total, error } = await supabase
      .from("ai_memory")
      .select("id", { count: "exact", head: true });
    if (!error && typeof total === "number") setCount(total);
  }, []);

  useEffect(() => {
    if (user) refreshCount();
  }, [user, refreshCount]);

  const saveCorrection = useCallback(
    async ({ promptContext, aiMessage, correction, tags }: SaveCorrectionInput) => {
      if (!user) throw new Error("Trebuie să fii autentificat pentru a salva o regulă.");
      const cleanTags = (tags ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const { error } = await supabase.from("ai_memory").insert({
        user_id: user.id,
        prompt_context: promptContext.slice(0, 4000),
        ai_message: aiMessage ? aiMessage.slice(0, 8000) : null,
        correction: correction.slice(0, 4000),
        tags: cleanTags,
      });
      if (error) throw new Error(error.message);
      await refreshCount();
    },
    [user, refreshCount],
  );

  const searchMemory = useCallback(async (queryText: string): Promise<AiMemoryMatch[]> => {
    const text = queryText.trim();
    if (!text) return [];
    const { data, error } = await supabase.rpc("match_ai_memory", { query_text: text });
    if (error) {
      console.warn("match_ai_memory error:", error.message);
      return [];
    }
    return (data ?? []) as AiMemoryMatch[];
  }, []);

  return { count, refreshCount, saveCorrection, searchMemory };
}
