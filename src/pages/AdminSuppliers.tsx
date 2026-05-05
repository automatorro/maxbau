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
import { Plus, Pencil, Trash2, Save, X, Building2 } from "lucide-react";
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
    const { error } = await supabase.from("suppliers").delete().eq("id", deleteId);
    if (error) { toast.error(error.message); return; }
    setDeleteId(null);
    queryClient.invalidateQueries({ queryKey: ["admin-suppliers"] });
    toast.success("Furnizor șters");
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6" /> Furnizori
          </h1>
          <p className="text-sm text-muted-foreground">Gestionează furnizorii și profilele lor de import</p>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nume</TableHead>
                    <TableHead className="w-[100px]">Importuri</TableHead>
                    <TableHead className="w-[100px]">Profil AI</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="w-[100px]">Acțiuni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        {editingId === s.id ? (
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm" />
                        ) : (
                          <span className="font-medium">{s.name}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{priceSheetCounts[s.id] || 0}</Badge>
                      </TableCell>
                      <TableCell>
                        {s.ai_column_map && Object.keys(s.ai_column_map).length > 0 ? (
                          <Badge variant="default" className="bg-green-600 text-[10px]">Salvat</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingId === s.id ? (
                          <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="text-xs min-h-[60px]" placeholder="Observații..." />
                        ) : (
                          <span className="text-xs text-muted-foreground">{s.notes || "—"}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingId === s.id ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveEdit}><Save className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)}><X className="h-3 w-3" /></Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(s)}><Pencil className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(s.id)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* AI Column Map Details */}
        {suppliers.filter((s) => s.ai_column_map && Object.keys(s.ai_column_map).length > 0).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Profile AI salvate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {suppliers.filter((s) => s.ai_column_map && Object.keys(s.ai_column_map).length > 0).map((s) => (
                <div key={s.id} className="border rounded p-2 space-y-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(s.ai_column_map || {}).map(([key, val]) => (
                      <Badge key={key} variant="outline" className="text-[10px]">
                        {key}: {typeof val === "number" ? `col ${(val as number) + 1}` : String(val)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Delete Dialog */}
        <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Ștergi furnizorul?</AlertDialogTitle>
              <AlertDialogDescription>Listele de preț asociate nu vor fi șterse, dar vor pierde legătura cu furnizorul.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Anulează</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>Șterge</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default AdminSuppliers;
