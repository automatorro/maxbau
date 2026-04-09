import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Calculator, FilePlus, FileText, Package, Settings, Tags, ArrowRight } from "lucide-react";

const Index = () => {
  const mainItems = [
    { title: "Catalog", url: "/catalog", icon: Package },
    { title: "Ofertă nouă", url: "/quote/new", icon: FilePlus },
    { title: "Generare rețetă", url: "/recipe-quote", icon: Calculator },
    { title: "Ofertele mele", url: "/quotes", icon: FileText },
  ];

  const adminItems = [
    { title: "Produse", url: "/admin/products", icon: Settings },
    { title: "Discounturi", url: "/admin/discounts", icon: Tags },
  ];

  const tiles = [
    { section: "Principal", items: mainItems },
    { section: "Administrare", items: adminItems },
  ];

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-7">
          <div className="inline-flex items-center rounded-full px-3 py-1 text-sm bg-primary/10 text-primary ring-1 ring-primary/20">
            Max Bau Materiale
          </div>
          <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight">Acasă</h2>
          <p className="text-muted-foreground mt-2">Alege rapid unde vrei să mergi.</p>
        </div>

        <div className="space-y-8">
          {tiles.map((group) => (
            <section key={group.section}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{group.section}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {group.items.map((item) => (
                  <Link
                    key={item.title}
                    to={item.url}
                    className="group rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <Card className="h-full p-5 md:p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg border-border/70 bg-gradient-to-br from-primary/10 via-card to-card">
                      <div className="flex items-center gap-4">
                        <div className="h-14 w-14 rounded-xl bg-primary/15 text-primary flex items-center justify-center ring-1 ring-primary/20">
                          <item.icon className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-lg font-semibold truncate">{item.title}</div>
                          <div className="text-sm text-muted-foreground truncate">{item.url}</div>
                        </div>
                        <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
