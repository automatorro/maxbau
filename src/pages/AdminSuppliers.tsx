import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Save, X, Building2, Wand2, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Supplier = {
  id: string;
  name: string;
  ai_column_map: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const AdminSuppliers = () => {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [newName, setNewName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isMapping, setIsMapping] = useState(false);

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["admin-suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, ai_column_map, notes, created_at, updated_at")
        .order("name");
      if (error) throw error;
      return data as Supplier[];
    },
  });

  const { data: priceSheetCounts = {} } = useQuery({
    queryKey: ["supplier-price-sheet-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_sheets")
        .select("supplier_id")
        .not("supplier_id", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        if (row.supplier_id) counts[row.supplier_id] = (counts[row.supplier_id] || 0) + 1;
      }
      return counts;
    },
  });

  const { data: productCounts = {} } = useQuery({
    queryKey: ["supplier-products-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("supplier_id")
        .not("supplier_id", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        if (row.supplier_id) counts[row.supplier_id] = (counts[row.supplier_id] || 0) + 1;
      }
      return counts;
    },
  });

  const createSupplier = async () => {
    const name = newName.trim();
    if (!name) return;
    const { error } = await supabase.from("suppliers").insert({ name });
    if (error) { toast.error(error.message); return; }
    setNewName("");
    queryClient.invalidateQueries({ queryKey: ["admin-suppliers"] });
    toast.success(`Furnizor "${name}" creat`);
  };

  const startEdit = (s: Supplier) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditNotes(s.notes || "");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const { error } = await supabase.from("suppliers").update({ name: editName.trim(), notes: editNotes.trim() || null }).eq("id", editingId);
    if (error) { toast.error(error.message); return; }
    setEditingId(null);
    queryClient.invalidateQueries({ queryKey: ["admin-suppliers"] });
    toast.success("Furnizor actualizat");
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    
    // Unlink products and price sheets first to prevent FK constraint errors
    await supabase.from("products").update({ supplier_id: null }).eq("supplier_id", deleteId);
    await supabase.from("price_sheets").update({ supplier_id: null }).eq("supplier_id", deleteId);

    const { error, count } = await supabase.from("suppliers").delete().eq("id", deleteId);
    if (error) { toast.error(error.message); return; }
    
    setDeleteId(null);
    queryClient.invalidateQueries({ queryKey: ["admin-suppliers"] });
    toast.success("Furnizor șters definitiv");
  };

  const autoMapProducts = async () => {
    if (suppliers.length === 0) {
      toast.info("Nu există furnizori definiți.");
      return;
    }
    setIsMapping(true);
    try {
      const { data: unmappedProducts, error } = await supabase
        .from("products")
        .select("id, denumire_completa")
        .is("supplier_id", null);
        
      if (error) throw error;
      
      let mapCount = 0;
      const updates = [];
      
      for (const p of unmappedProducts || []) {
        const lowerName = p.denumire_completa.toLowerCase();
        for (const s of suppliers) {
          if (lowerName.includes(s.name.toLowerCase())) {
            updates.push({
              id: p.id,
              supplier_id: s.id,
              manufacturer: s.name
            });
            mapCount++;
            break; 
          }
        }
      }
      
      if (updates.length > 0) {
        const chunkSize = 50;
        for (let i = 0; i < updates.length; i += chunkSize) {
          const chunk = updates.slice(i, i + chunkSize);
          await Promise.all(chunk.map(u => 
            supabase.from("products").update({ supplier_id: u.supplier_id, manufacturer: u.manufacturer }).eq("id", u.id)
          ));
        }
      }
      
      toast.success(`S-au mapat automat ${mapCount} produse.`);
      queryClient.invalidateQueries({ queryKey: ["supplier-products-counts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    } catch (error: any) {
      toast.error(`Eroare la mapare: ${error.message}`);
    } finally {
      setIsMapping(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="h-6 w-6" /> Furnizori
            </h1>
            <p className="text-sm text-muted-foreground">Gestionează furnizorii și asocierile cu produsele</p>
          </div>
          <Button onClick={autoMapProducts} disabled={isMapping || isLoading} variant="outline" className="gap-2 shrink-0 border-primary/20 hover:bg-primary/5">
            {isMapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4 text-primary" />}
            {isMapping ? "Se mapează..." : "Auto-Mapează Produse"}
          </Button>
        </div>

        {/* Create new */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-xs">Furnizor nou</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Baumit, Weber, Knauf..." className="h-9" onKeyDown={(e) => e.key === "Enter" && createSupplier()} />
              </div>
              <Button onClick={createSupplier} disabled={!newName.trim()} className="gap-1.5">
                <Plus className="h-4 w-4" /> Adaugă
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lista furnizori ({suppliers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Se încarcă...</p>
            ) : suppliers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Niciun furnizor adăugat încă.</p>
            ) : (
            <div className="space-y-0">
              {/* Desktop table */}
              <div className="hidden md:block rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nume</TableHead>
                      <TableHead className="w-[120px] text-center">Produse asoc.</TableHead>
                      <TableHead className="w-[120px] text-center">Importuri OCR</TableHead>
                      <TableHead>Note / Observații</TableHead>
                      <TableHead className="w-[100px] text-right">Acțiuni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suppliers.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          {editingId === s.id ? (
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm max-w-[200px]" />
                          ) : (
                            <span className="font-medium">{s.name}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={productCounts[s.id] ? "default" : "secondary"} className={productCounts[s.id] ? "bg-primary text-primary-foreground" : ""}>
                            {productCounts[s.id] || 0}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-muted-foreground">
                            {priceSheetCounts[s.id] || 0}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {editingId === s.id ? (
                            <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="text-xs min-h-[40px]" placeholder="Observații..." />
                          ) : (
                            <span className="text-xs text-muted-foreground">{s.notes || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingId === s.id ? (
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={saveEdit}><Save className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)}><X className="h-4 w-4" /></Button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => startEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card view */}
              <div className="md:hidden space-y-2">
                {suppliers.map((s) => (
                  <div key={s.id} className="rounded-lg border bg-card p-3 space-y-2">
                    {editingId === s.id ? (
                      <div className="space-y-2">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 text-sm" placeholder="Nume furnizor" />
                        <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="text-xs min-h-[60px]" placeholder="Observații..." />
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1 gap-1.5" onClick={saveEdit}><Save className="h-3.5 w-3.5" /> Salvează</Button>
                          <Button variant="outline" size="sm" onClick={() => setEditingId(null)}><X className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm">{s.name}</p>
                            {s.notes && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.notes}</p>}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => startEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground uppercase">Produse:</span>
                            <Badge variant={productCounts[s.id] ? "default" : "secondary"} className={`text-[10px] ${productCounts[s.id] ? "bg-primary text-primary-foreground" : ""}`}>
                              {productCounts[s.id] || 0}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground uppercase">Importuri:</span>
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {priceSheetCounts[s.id] || 0}
                            </Badge>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            )}
          </CardContent>
        </Card>

        {/* AI Column Map Details */}
        {suppliers.filter((s) => s.ai_column_map && Object.keys(s.ai_column_map).length > 0).length > 0 && (
          <div className="pt-4 border-t border-border mt-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Metadate Profile Import AI</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {suppliers.filter((s) => s.ai_column_map && Object.keys(s.ai_column_map).length > 0).map((s) => (
                <div key={s.id} className="border rounded-md p-3 bg-muted/20 space-y-2">
                  <p className="text-sm font-semibold">{s.name}</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(s.ai_column_map || {}).map(([key, val]) => (
                      <Badge key={key} variant="outline" className="text-[10px] bg-background">
                        {key}: {typeof val === "number" ? `col ${(val as number) + 1}` : String(val)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delete Dialog */}
        <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Ștergi furnizorul?</AlertDialogTitle>
              <AlertDialogDescription>Listele de preț și produsele asociate nu vor fi șterse, dar vor pierde legătura cu acest furnizor.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Anulează</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={confirmDelete}>Șterge definitiv</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default AdminSuppliers;
