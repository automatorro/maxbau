import { useState, useRef, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, User, Send, Loader2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type MessageRole = "user" | "assistant";

interface Message {
  role: MessageRole;
  content: string;
}

const GREETING =
  "Bună ziua! Sunt consultant tehnic la MAXBAU MATERIALE SRL. " +
  "Sunt aici să vă ajut să găsiți materialele potrivite pentru proiectul dumneavoastră. " +
  "Ca să vă pot recomanda cel mai bine, spuneți-mi pe scurt: ce construiți sau renovați și în ce fază sunteți?";

export default function Consultant() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: Message = { role: "user", content: text };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("ai-consultant", {
        body: {
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        },
      });

      if (error) throw error;
      if (!data?.response) throw new Error("Răspuns gol de la AI");

      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
    } catch (e) {
      console.error("Consultant AI error:", e);
      toast.error("Eroare la conectarea cu consultantul AI. Încearcă din nou.");
      setMessages(messages);
      setInput(text);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setMessages([{ role: "assistant", content: GREETING }]);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col max-w-3xl mx-auto" style={{ height: "calc(100vh - 7rem)" }}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              Consultant AI
            </h1>
            <p className="text-sm text-muted-foreground">
              Inginer de vânzări MAXBAU — consultanță tehnică în timp real
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="gap-1.5 shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Conversație nouă
          </Button>
        </div>

        <Card className="flex-1 overflow-hidden flex flex-col min-h-0">
          <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm"
                      }`}
                    >
                      {msg.content}
                    </div>
                    {msg.role === "user" && (
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}

                {loading && (
                  <div className="flex gap-3 justify-start">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="flex gap-2 mt-3 shrink-0">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Scrieți întrebarea despre produse sau proiect..."
            disabled={loading}
            className="flex-1"
            autoFocus
          />
          <Button onClick={handleSend} disabled={loading || !input.trim()} size="icon">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
