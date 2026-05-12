import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Package,
  FilePlus,
  FileText,
  Calculator,
  ScanText,
  Lightbulb,
  FlaskConical,
  Settings,
  Tags,
  Table,
  ArrowRight,
  Sparkles,
  TrendingUp,
  Zap,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const salesFeatures = [
  {
    title: "Ofertă din cerere client",
    subtitle: "Ofertare inteligentă cu AI",
    description:
      "Notați ce a cerut clientul, găsiți produse echivalente din catalogul MaxBau și obțineți detalii tehnice generate de AI — consum, ambalaj, alternative — în câteva secunde.",
    url: "/quote/smart",
    icon: Lightbulb,
    badge: "NOU · AI",
    badgeVariant: "default" as const,
    highlight: true,
    gradient: "from-amber-500/20 via-orange-500/10 to-transparent",
    iconBg: "bg-amber-500/15 text-amber-600 ring-amber-500/30",
  },
  {
    title: "Import OCR / Excel",
    subtitle: "Digitalizare liste de prețuri",
    description:
      "Fotografiați sau încărcați listele de prețuri ale furnizorilor. Aplicația recunoaște textul, potrivește automat produsele din catalog și salvează prețurile cu un singur click.",
    url: "/import",
    icon: ScanText,
    badge: "NOU",
    badgeVariant: "secondary" as const,
    highlight: true,
    gradient: "from-blue-500/20 via-cyan-500/10 to-transparent",
    iconBg: "bg-blue-500/15 text-blue-600 ring-blue-500/30",
  },
  {
    title: "Ofertă nouă",
    subtitle: "Ofertare clasică rapidă",
    description:
      "Creați oferte complete cu discount per produs, calcul TVA automat și export Excel cu antet profesional — gata de trimis clientului.",
    url: "/quote/new",
    icon: FilePlus,
    gradient: "from-primary/15 via-primary/5 to-transparent",
    iconBg: "bg-primary/15 text-primary ring-primary/25",
  },
  {
    title: "Generare rețetă",
    subtitle: "Calcul cantități pe suprafață",
    description:
      "Calculați automat cantitățile necesare pentru un proiect pe baza suprafeței și a consumului produselor — eliminați erorile de estimare.",
    url: "/recipe-quote",
    icon: Calculator,
    gradient: "from-violet-500/15 via-violet-500/5 to-transparent",
    iconBg: "bg-violet-500/15 text-violet-600 ring-violet-500/25",
  },
  {
    title: "Catalog produse",
    subtitle: "Căutare și filtrare avansată",
    description:
      "Acces rapid la întregul catalog MaxBau cu prețuri actualizate, filtrare pe categorii și vizualizare date tehnice per produs.",
    url: "/catalog",
    icon: Package,
    gradient: "from-emerald-500/15 via-emerald-500/5 to-transparent",
    iconBg: "bg-emerald-500/15 text-emerald-600 ring-emerald-500/25",
  },
  {
    title: "Ofertele mele",
    subtitle: "Istoric și urmărire",
    description:
      "Vizualizați toate ofertele create, reluați ciornele, exportați în Excel și urmăriți statusul fiecărei oferte trimise.",
    url: "/quotes",
    icon: FileText,
    gradient: "from-slate-500/15 via-slate-500/5 to-transparent",
    iconBg: "bg-slate-500/15 text-slate-600 ring-slate-500/25",
  },
];

const adminFeatures = [
  {
    title: "Catalog & Date Tehnice",
    subtitle: "Administrare produse și motor AI",
    url: "/admin/products",
    icon: Settings,
    badge: "CENTRALIZAT",
  },
  {
    title: "Discounturi",
    subtitle: "Reguli per client/categorie",
    url: "/admin/discounts",
    icon: Tags,
  },
];

const pillars = [
  { icon: Zap, label: "Ofertare în minute, nu ore" },
  { icon: Sparkles, label: "Echivalențe sugerate de AI" },
  { icon: TrendingUp, label: "Prețuri mereu actualizate" },
  { icon: Shield, label: "Date centralizate, sigure" },
];

const Index = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-primary/8 via-background to-background">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-12 md:py-16 md:px-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-primary/10 text-primary ring-1 ring-primary/25">
              <Sparkles className="h-3 w-3" />
              Platformă digitală pentru forța de vânzări
            </div>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground leading-tight">
            Max Bau —{" "}
            <span className="text-primary">mai rapid,</span>
            <br className="hidden sm:block" /> mai precis, mai câștigat.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
            Instrumentul intern care transformă orice cerere de client într-o ofertă
            profesională în câteva minute. De la OCR pe liste de prețuri la echivalențe
            sugerate de inteligența artificială.
          </p>

          {user && (
            <p className="mt-3 text-sm text-muted-foreground">
              Conectat ca{" "}
              <span className="font-medium text-foreground">{user.email}</span>
            </p>
          )}

          {/* Pillars */}
          <div className="mt-8 flex gap-2 sm:gap-3 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-x-visible sm:pb-0">
            {pillars.map((p) => (
              <div
                key={p.label}
                className="flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-1.5 text-xs sm:text-sm text-foreground/80 whitespace-nowrap shrink-0 sm:shrink"
              >
                <p.icon className="h-3.5 w-3.5 text-primary" />
                {p.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sales features */}
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        <div className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Instrumente de vânzare
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {salesFeatures.map((item) => (
            <Link
              key={item.url}
              to={item.url}
              className="group relative rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <div
                className={`
                  relative h-full rounded-xl border bg-gradient-to-br ${item.gradient}
                  p-5 md:p-6 transition-all duration-200
                  hover:-translate-y-0.5 hover:shadow-xl hover:border-primary/30
                  ${item.highlight ? "border-primary/20 shadow-sm" : "border-border/60"}
                `}
              >
                <div className="flex items-start justify-between mb-4">
                  <div
                    className={`h-12 w-12 rounded-xl flex items-center justify-center ring-1 ${item.iconBg}`}
                  >
                    <item.icon className="h-6 w-6" />
                  </div>
                  {item.badge && (
                    <Badge
                      variant={item.badgeVariant ?? "outline"}
                      className="text-[10px] font-semibold tracking-wide"
                    >
                      {item.badge}
                    </Badge>
                  )}
                </div>
                <div className="space-y-1 mb-3">
                  <h3 className="text-base font-semibold text-foreground leading-snug">
                    {item.title}
                  </h3>
                  <p className="text-xs font-medium text-primary/80">{item.subtitle}</p>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
                <div className="mt-4 flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  Deschide
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Admin features */}
        <div className="mt-10 mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Administrare
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {adminFeatures.map((item) => (
            <Link
              key={item.url}
              to={item.url}
              className="group rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <div className="h-full rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                    <item.icon className="h-4.5 w-4.5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  {item.badge && (
                    <Badge variant="secondary" className="text-[10px]">
                      {item.badge}
                    </Badge>
                  )}
                </div>
                <p className="text-sm font-semibold text-foreground leading-snug">
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
