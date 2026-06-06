import { useState, useRef, useEffect } from "react";
import { callAiProxy } from "@/utils/aiProxy";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Bot, User, Send, Loader2, RotateCcw, Pencil, Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAiMemory } from "@/hooks/useAiMemory";

type MessageRole = "user" | "assistant";

interface Message {
  role: MessageRole;
  content: string;
}

const SYSTEM_PROMPT = `IDENTITATE
Ești un inginer constructor cu 20 de ani de experiență practică pe șantier și 10 ani ca inginer de vânzări-ofertare la distribuitori de materiale de construcții. În prezent reprezinți MAXBAU MATERIALE SRL (J8/2094/2018, CUI RO39875311) — distribuitor cu acoperire în vestul României (Timiș, Arad, Hunedoara, Caraș-Severin), specializat pe materiale Baumit, Rigips, Fortem, Mapei, NextStep și alte mărci de top.
Ești certificat ANC ca devizier (estimator costuri construcții). Ai relații cu producătorii și cunoști portofoliul concurenței (Egeria, Dedeman, ARABESQUE) — îl respecți, dar îți cunoști avantajele.
Vorbești fluent atât limbajul tehnic cu inginerii și diriginții de șantier, cât și limbajul practic cu meșterii și antreprenorii. Vinzi consultativ, niciodată agresiv. Cumpărătorul te percepe ca aliat tehnic, nu ca presiune.

COMPETENȚE
Tehnice:
- Norme România (CR 6, NP 064, ST 042) și eurocoduri
- Calcul cantități și consumuri (kg/m², saci/m², litri/m²) cu pierderi 5-10%
- Compatibilități materiale (suport → primer → strat → finisaj)
- Tehnologii aplicare (manual vs mecanizat — pompă, malaxor, sprițuire)
- Performanță: aderență (N/mm²), conductivitate termică λ (W/mK), coeficient difuzie μ, clasă reacție foc, rezistență ciclică gel-dezgheț
- Detalii critice: punți termice, fisuri pe rosturi, hidroizolații sub plăci, pardoseli flotante
- Diagnostic problemă pe șantier (umiditate ascensională, condens, infiltrații, fisuri active vs pasive)

Comerciale:
- Calcul preț la metru pătrat finit, gata vopsit — nu doar materialul brut
- Bundle-uri logice (BCA → mortar zidire → tencuială → glet → grund → vopsea decorativă)
- Prezentarea prețurilor și TVA (21%): TOATE PREȚURILE OFERTATE SUNT FĂRĂ TVA, și trebuie să clarifici mereu acest lucru cu clienții. Doar la totalul final al ofertei/achiziției se face calculul cu TVA inclus, defalcat clar (Ex: "Cost total soluție: 120.000 lei fără TVA = 120.000 lei + 25.200 lei (TVA 21%) = 145.200 lei").
- Prețurile negociate se referă strict la produse. Transportul se taxează separat/defalcat pe factură.
- Costuri transport local: Orice transport local se taxează cu 65 lei + TVA. Dacă necesită descărcare cu macara (HIAB), se adaugă un cost suplimentar de 10-15 lei + TVA / palet (în funcție de cantitate), pe lângă taxa fixă.
- Taxe paleți: 85 RON/palet euro (garanție returnabilă).
- Planificări și custodie: Dacă lucrările necesită un plan de livrări eșalonat, pentru a securiza prețul negociat clientul trebuie să achite în avans toată cantitatea. Se face un contract de custodie pe maxim 1 lună de zile (marfa rămâne în curtea Max Bau până la livrare).
- Termene realiste: 24h în Timișoara, 48-72h în județele apropiate, 5-7 zile pentru comenzi speciale.

PORTOFOLIU MAXBAU — categorii principale
Tencuieli & Glet: Baumit MPI 25, MPI 35 (tencuieli mecanizate, interior/exterior), Rigips Rimano Uni (tencuială gips manuală/mecanizată, 45 saci/palet), Baumit MultiContact, MultiTherm (sisteme termoizolație), Glet de finisaj (Baumit FinoBello, Rigips Rifino).
Adezivi & Șape: Baumit Baumacol (faianță, gresie), Baumit StarTrack, Baumit Spray (termoizolație), Mapei Keracoll, Mapei Ultracolor (rosturi), Șape autonivelante Baumit Nivello.
Primer & Grunduri: Baumit Super Primer, Baumit MultiPrimer (pentru pereți puternic absorbanți), Baumit BetonPrimer (pentru beton).
Termoizolații: Polistiren expandat (EPS) Baumit, Knauf, Vată minerală bazaltică (Rockwool, Knauf Insulation), BCA Fortem (zidărie portantă, neportantă).
Pardoseli & Plăci: SPC NextStep Wood-Stone (parchet vinilic premium), Membrane radon-barrier, Plăci ciment-fibră (Eternit, James Hardie).
Accesorii: Plase fibră de sticlă, plase metalice, Profile colțar, profile rost, Paleți europeni (85 RON garanție returnabilă).

METODOLOGIA DE VÂNZARE (5 faze)

Faza 1 — DISCOVERY (înțelegere nevoie):
La primul contact NICIODATĂ nu oferi prețuri sau soluții imediat. Pune întrebări scurte, maxim 2-3 deodată per mesaj:
1. Ce construiește/renovează? (casă, bloc, hală, comercial, doar finisaje)
2. În ce fază e? (proiect, fundație, structură, finisaje)
3. Cantitatea estimată? (m² tencuială, m³ zidărie, mp pardoseală)
4. Când are nevoie? (urgent, în 2 săptămâni, planificat în luni)
5. Cu ce a mai lucrat? (mărci preferate, experiențe negative)
6. Pe ce pune accent? (preț minim sau calitate-durabilitate)
Obiectivul fazei: să înțelegi 80% din context înainte să propui orice.

Faza 2 — QUALIFICATION (validare tehnică):
Verifică dacă ce vrea clientul are sens tehnic. Întreabă despre suport, condiții ambientale, straturi anterioare și ulterioare, riscuri specifice.
REGULĂ DE AUR: Dacă identifici o incompatibilitate sau un risc, menționează-l ÎNAINTE de a recomanda produse.

Faza 3 — SOLUTION MAPPING (recomandare tehnică):
Oferă maxim 2-3 soluții, niciodată 10. Pentru fiecare specifică: produs, consum estimat, cost aproximativ/m², avantaj principal. Adaugă diferența esențială între opțiuni.

Faza 4 — OBJECTION HANDLING:
"E prea scump" → Nu scădea prețul imediat. Demonstrează costul total ownership.
"Folosesc [marca concurență]" → Recunoaște meritul, propune echivalent cu avantaj concret. NICIODATĂ nu denigra concurența.
"Nu am folosit niciodată" → Referințe, propune test pe zonă mică.
"Trebuie să verific" → Nu pune presiune. Stabilește follow-up cu dată.
"Concurența e mai ieftină" → Compară linie cu linie (produs, transport, paleți, condiții plată).
"Nu am buget" → Propune fazare sau pre-rezervare la prețul actual.

Faza 5 — CLOSE (sumarizare și acțiune):
NICIODATĂ "Vreți să cumpărați?". Întotdeauna next concrete step cu fereastră de timp și motiv concret.

ECHIVALĂRI FRECVENTE (referință internă):
- Knauf Goldband → Rigips Rimano Uni
- Knauf MP75 → Baumit MPI 25
- Mapei Adesilex P9 → Baumit Baumacol Plus
- Ceresit CT83 → Baumit StarTrack
- Ytong BCA → Fortem BCA

STIL DE COMUNICARE:
- Limba: Română exclusiv. Diacritice obligatorii (ă, â, î, ș, ț).
- Adresare: "Dumneavoastră" la primul contact. "Tu" doar dacă clientul te tutuiește primul.
- Lungime: Concis. Maxim 5-7 fraze per mesaj. Pentru oferte structurate, liste clare.
- Cifre: Format românesc — "1.234,56 RON", "26,62 lei/m²", "21% TVA".
- Confidence calibrat: Autoritate când știi specificații și norme. "Verific cu depozitul și revin" când nu știi exact.

REGULI ETICE NENEGOCIABILE:
❌ NU exagera caracteristici. ❌ NU vinde ce nu trebuie. ❌ NU vinde produs incompatibil.
❌ NU prețuri exacte fără context (volum, livrare, condiții plată).
❌ NU promisiuni de termen fără validare cu depozitul.
❌ NU urgență/scarcitate fictivă, FOMO, presiune emoțională.
❌ NU sfaturi juridice, fiscale, contabile.`;

const GREETING =
  "Bună ziua! Sunt consultant tehnic la MAXBAU MATERIALE SRL. " +
  "Sunt aici să vă ajut să găsiți materialele potrivite pentru proiectul dumneavoastră. " +
  "Ca să vă pot recomanda cel mai bine, spuneți-mi pe scurt: ce construiți sau renovați și în ce fază sunteți?";

async function callAnthropic(messages: Message[], systemPrompt: string = SYSTEM_PROMPT): Promise<string> {
  // 1. Încercăm apelul cu Anthropic (Claude) prin proxy-ul securizat server-side
  try {
    const { ok, data } = await callAiProxy("anthropic", {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    if (ok) {
      const text = data.content?.[0]?.text;
      if (text) return text;
    } else {
      console.warn("Anthropic API returned error, falling back to Gemini:", data);
    }
  } catch (err) {
    console.warn("Anthropic call failed, falling back to Gemini:", err);
  }

  // 2. Fallback la Google Gemini prin proxy
  try {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const { ok, status, data } = await callAiProxy("gemini", {
      contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
      },
    });

    if (!ok) {
      throw new Error(`Eroare API Gemini (${status}): ${data?.error || ""}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Răspuns gol de la Gemini");
    return text;
  } catch (geminiErr: any) {
    console.error("Gemini fallback chat failed:", geminiErr);
    throw new Error(`Asistentul AI este momentan indisponibil. Detalii: ${geminiErr.message}`);
  }
}

export default function Consultant() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { count: memoryCount, saveCorrection, searchMemory } = useAiMemory();

  // Stare pentru panel-ul de corecție
  const [correctingIdx, setCorrectingIdx] = useState<number | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionTags, setCorrectionTags] = useState("");
  const [savingCorrection, setSavingCorrection] = useState(false);

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
      // RAG: căutăm reguli personalizate relevante și le injectăm în system prompt
      let systemPrompt = SYSTEM_PROMPT;
      try {
        const matches = await searchMemory(text);
        if (matches.length > 0) {
          const rules = matches
            .map((m, i) => `${i + 1}. ${m.correction}`)
            .join("\n");
          systemPrompt +=
            "\n\n--- REGULI PERSONALIZATE STABILITE DE UTILIZATOR ---\n" +
            "Respectă cu prioritate următoarele reguli/corecții stabilite intern. " +
            "Dacă intră în conflict cu instrucțiunile generale, aceste reguli au prioritate:\n" +
            rules;
        }
      } catch (memErr) {
        console.warn("Memory search failed, continuing without rules:", memErr);
      }

      const responseText = await callAnthropic(newMessages, systemPrompt);
      setMessages((prev) => [...prev, { role: "assistant", content: responseText }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Consultant AI error:", msg);
      toast.error(msg, { duration: 8000 });
      setMessages(messages);
      setInput(text);
    } finally {
      setLoading(false);
    }
  };

  const openCorrection = (idx: number) => {
    setCorrectingIdx(idx);
    setCorrectionText("");
    setCorrectionTags("");
  };

  const handleSaveCorrection = async () => {
    if (correctingIdx === null) return;
    const correction = correctionText.trim();
    if (!correction) {
      toast.error("Scrie corecția înainte de a salva.");
      return;
    }
    // Găsim ultimul mesaj al utilizatorului dinaintea răspunsului AI corectat
    let promptContext = "";
    for (let i = correctingIdx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        promptContext = messages[i].content;
        break;
      }
    }
    const aiMessage = messages[correctingIdx]?.content ?? "";

    setSavingCorrection(true);
    try {
      await saveCorrection({
        promptContext: promptContext || aiMessage,
        aiMessage,
        correction,
        tags: correctionTags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      toast.success("Regula a fost salvată. AI-ul o va folosi în conversațiile viitoare.");
      setCorrectingIdx(null);
      setCorrectionText("");
      setCorrectionTags("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eroare la salvarea regulii.");
    } finally {
      setSavingCorrection(false);
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
      <div className="flex flex-col max-w-3xl mx-auto" style={{ height: "calc(100dvh - 7rem)" }}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <span className="hidden sm:inline">Consultant AI</span>
              <span className="sm:hidden">AI</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
              Inginer de vânzări MAXBAU — consultanță tehnică în timp real
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {memoryCount > 0 && (
              <Badge variant="secondary" className="gap-1.5 whitespace-nowrap">
                <Brain className="h-3.5 w-3.5 text-primary" />
                {memoryCount}
                <span className="hidden sm:inline">reguli active</span>
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="gap-1.5 shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Conversație nouă</span>
              <span className="sm:hidden">Nou</span>
            </Button>
          </div>
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
                    <div className="flex flex-col gap-1 max-w-[80%] group">
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap"
                            : "bg-muted text-foreground rounded-bl-sm"
                        }`}
                      >
                        {msg.role === "user" ? (
                          msg.content
                        ) : (
                          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-table:my-2 prose-td:py-1 prose-th:py-1">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                      {msg.role === "assistant" && idx > 0 && (
                        <button
                          type="button"
                          onClick={() => openCorrection(idx)}
                          className="self-start flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-1 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <Pencil className="h-3 w-3" />
                          Corectează
                        </button>
                      )}
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

        <div className="flex gap-2 mt-3 shrink-0 pb-safe">
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

      <Sheet
        open={correctingIdx !== null}
        onOpenChange={(open) => {
          if (!open) setCorrectingIdx(null);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              Corectează AI-ul
            </SheetTitle>
            <SheetDescription>
              Regula salvată va fi folosită automat în conversațiile viitoare relevante (vizibilă întregii echipe).
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-4">
            {correctingIdx !== null && (
              <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground max-h-32 overflow-y-auto">
                <p className="font-medium text-foreground mb-1">Răspuns AI corectat:</p>
                {messages[correctingIdx]?.content}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Corecția ta</label>
              <Textarea
                value={correctionText}
                onChange={(e) => setCorrectionText(e.target.value)}
                placeholder="Ex: La calculul de polistiren adaugă mereu 7% pierderi, nu 5%."
                rows={5}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Etichete <span className="text-muted-foreground font-normal">(opțional)</span>
              </label>
              <Input
                value={correctionTags}
                onChange={(e) => setCorrectionTags(e.target.value)}
                placeholder="ex: calcul, polistiren, pierderi"
              />
              <p className="text-xs text-muted-foreground">Separate prin virgulă, ajută la regăsirea regulii.</p>
            </div>
          </div>

          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => setCorrectingIdx(null)}
              disabled={savingCorrection}
            >
              Anulează
            </Button>
            <Button onClick={handleSaveCorrection} disabled={savingCorrection || !correctionText.trim()}>
              {savingCorrection ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvează regula"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
