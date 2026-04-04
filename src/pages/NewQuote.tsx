import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilePlus } from "lucide-react";

const NewQuote = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ofertă nouă</h1>
          <p className="text-muted-foreground">Creează o ofertă nouă pentru client</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FilePlus className="h-5 w-5" />
              Generator oferte
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Generatorul de oferte va fi implementat în fazele următoare.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default NewQuote;
