import {
  Package,
  FilePlus,
  FileText,
  Settings,
  Tags,
  LogOut,
  Calculator,
  Table,
  ScanText,
  Lightbulb,
  FlaskConical,
  ClipboardList,
  MessageSquare,
  Layers,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
 
const mainItems = [
  { title: "Catalog", url: "/catalog", icon: Package },
  { title: "Import OCR/Excel", url: "/import", icon: ScanText },
  { title: "Ofertă nouă", url: "/quote/new", icon: FilePlus },
  { title: "Ofertă din cerere client", url: "/quote/smart", icon: Lightbulb },
  { title: "Configurator Vată & Ambalaj", url: "/wool-configurator", icon: Layers },
  { title: "Import Antemasurătoare", url: "/quote/antemasuratori", icon: ClipboardList },
  { title: "Generare rețetă", url: "/recipe-quote", icon: Calculator },
  { title: "Ofertele mele", url: "/quotes", icon: FileText },
  { title: "Consultant AI", url: "/consultant", icon: MessageSquare },
];

const adminItems = [
  { title: "Produse", url: "/admin/products", icon: Settings },

  { title: "Discounturi", url: "/admin/discounts", icon: Tags },

];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { signOut, user } = useAuth();

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {!collapsed && (
              <span className="text-lg font-bold text-sidebar-primary">Max Bau</span>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{!collapsed && "Administrare"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {!collapsed && user && (
          <p className="px-3 text-xs text-sidebar-foreground/60 truncate">{user.email}</p>
        )}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "default"}
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Deconectare</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
