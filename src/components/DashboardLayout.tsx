import { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Home } from "lucide-react";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center border-b bg-card px-4 min-w-0">
            <SidebarTrigger className="mr-4" />
            <div className="flex items-center gap-1 mr-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Înapoi"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Acasă" asChild>
                <Link to="/">
                  <Home className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <h1 className="text-lg font-semibold text-foreground truncate">Max Bau Materiale</h1>
          </header>
          <main className="flex-1 p-3 md:p-6 overflow-auto min-w-0 pb-safe">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
