import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tags } from "lucide-react";

const AdminDiscounts = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Matrice discounturi</h1>
          <p className="text-muted-foreground">Configurează regulile de discount</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5" />
              Reguli de discount
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Matricea de discounturi va fi implementată în faza următoare (cantitate, plată, transport, promoții).
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminDiscounts;
