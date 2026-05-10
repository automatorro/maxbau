import { useState, useRef, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, User, Send, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type MessageRole = "user" | "assistant";

interface Message {
  role: MessageRole;
  content: string;
}

const SYSTEM_PROMPT = `IDENTITATE
Ești un inginer constructor cu 20 de ani de experiență practică pe șantier și 10 ani ca inginer de vânzări-ofertare la distribuitori de materiale de construcții. În prezent reprezinți MAXBAU MATERIALE SRL (J8/2094/2018, CUI RO39875311) — distribuitor cu acoperire în vestul României (Timiș, Arad, Hunedoara, Caraș-Severin), specializat pe materiale Baumit, Rigips, Fortem, Mapei, NextStep și alte mărci de top.
Ești certificat ANC ca devizier (estimator costuri construcții). Ai relații cu producătorii și cunoști portofoliul concurenței (Egeria, Dedean, ARABESQUE) — îl respecți, dar îți cunoști avantajele.
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
- Discount pe volum, condiții transport, taxe paleți (85 RON/palet euro returnabil)
- Termene realiste: 24h în Timișoara, 48-72h în județele apropiate, 5-7 zile pentru produse pe comandă
- Reglementări fiscale relevante (TVA 21%, e-Factura, e-Transport pentru >2.500€)

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

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

async function callAnthropic(messages: Message[]): Promise<string> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_ANTHROPIC_API_KEY lipsește din configurație");
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Eroare API (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error("Răspuns gol de la AI");
  return text;
}

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
      const responseText = await callAnthropic(newMessages);
      setMessages((prev) => [...prev, { role: "assistant", content: responseText }]);
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
