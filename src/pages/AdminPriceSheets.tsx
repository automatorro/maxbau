import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProductPicker } from "@/components/ProductPicker";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";

type PriceSheet = {
  id: string;
  name: string;
  source: string | null;
  received_at: string | null;
  active: boolean;
  created_at: string;
};

type PriceSheetItem = {
  id: string;
  price_sheet_id: string;
  product_id: string;
  label: string | null;
  unit: string | null;
  price: number;
  created_at: string;
  products?: {
    cod_intern: string;
    denumire_completa: string;
    unit: string | null;
  } | null;
};

type PickedProduct = {
  id: string;
  cod_intern: string;
  denumire_completa: string;
  unit: string | null;
};

const AdminPriceSheets = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedSheetId, setSelectedSheetId] = useState<string>("");

  const [newSheetName, setNewSheetName] = useState("");
  const [newSheetSource, setNewSheetSource] = useState("");
  const [newSheetReceivedAt, setNewSheetReceivedAt] = useState("");

  const [newItemProduct, setNewItemProduct] = useState<PickedProduct | null>(null);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");

  const { data: sheets = [], isLoading: sheetsLoading } = useQuery({
    queryKey: ["price-sheets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_sheets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PriceSheet[];
    },
  });

  const selectedSheet = useMemo(
    () => sheets.find((s) => s.id === selectedSheetId) || null,
    [sheets, selectedSheetId]
  );

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["price-sheet-items", selectedSheetId],
    enabled: Boolean(selectedSheetId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_sheet_items")
        .select("*, products(cod_intern, denumire_completa, unit)")
        .eq("price_sheet_id", selectedSheetId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as PriceSheetItem[];
    },
  });

  const { data: myRoles = [] } = useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", user!.id);
      if (error) throw error;
      return data as { role: "admin" | "moderator" | "user" }[];
    },
  });

  const isAdmin = useMemo(() => myRoles.some((r) => r.role === "admin"), [myRoles]);

  const errorToMessage = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    if (typeof e === "object" && e !== null && "message" in e && typeof (e as { message?: unknown }).message === "string") {
      return (e as { message: string }).message;
    }
    return "Eroare";
  };

  const createSheetMutation = useMutation({
    mutationFn: async () => {
      if (!newSheetName.trim()) throw new Error("Introduceți numele listei");
      const { data, error } = await supabase
        .from("price_sheets")
        .insert({
          name: newSheetName.trim(),
          source: newSheetSource.trim() || null,
          received_at: newSheetReceivedAt || null,
          active: false,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as PriceSheet;
    },
    onSuccess: (created) => {
      toast.success("Listă creată");
      setNewSheetName("");
      setNewSheetSource("");
      setNewSheetReceivedAt("");
      setSelectedSheetId(created.id);
      queryClient.invalidateQueries({ queryKey: ["price-sheets"] });
    },
    onError: (e) => {
      toast.error(errorToMessage(e) || "Eroare la creare listă");
    },
  });

  const activateSheetMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      if (!isAdmin) throw new Error("Nu ai drepturi admin pentru a activa liste de preț.");
      const { error: clearErr } = await supabase.from("price_sheets").update({ active: false }).eq("active", true);
      if (clearErr) throw clearErr;
      const { error: setErr } = await supabase.from("price_sheets").update({ active: true }).eq("id", sheetId);
      if (setErr) throw setErr;
    },
    onSuccess: () => {
      toast.success("Listă activată");
      queryClient.invalidateQueries({ queryKey: ["price-sheets"] });
    },
    onError: (e) => {
      toast.error(errorToMessage(e) || "Eroare la activare listă");
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSheetId) throw new Error("Selectați o listă");
      if (!newItemProduct?.id) throw new Error("Selectați un produs");
      const priceNum = Number(newItemPrice);
      if (!Number.isFinite(priceNum) || priceNum <= 0) throw new Error("Preț invalid");

      const { error } = await supabase.from("price_sheet_items").insert({
        price_sheet_id: selectedSheetId,
        product_id: newItemProduct.id,
        label: newItemLabel.trim() || null,
        unit: (newItemUnit || newItemProduct.unit || "").trim() || null,
        price: priceNum,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Linie adăugată");
      setNewItemProduct(null);
      setNewItemLabel("");
      setNewItemUnit("");
      setNewItemPrice("");
      queryClient.invalidateQueries({ queryKey: ["price-sheet-items", selectedSheetId] });
    },
    onError: (e) => {
      toast.error(errorToMessage(e) || "Eroare la adăugare linie");
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async (payload: { id: string; label: string | null; unit: string | null; price: number }) => {
      const { error } = await supabase
        .from("price_sheet_items")
        .update({
          label: payload.label,
          unit: payload.unit,
          price: payload.price,
        })
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-sheet-items", selectedSheetId] });
    },
    onError: (e) => {
      toast.error(errorToMessage(e) || "Eroare la editare linie");
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("price_sheet_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Linie ștearsă");
      queryClient.invalidateQueries({ queryKey: ["price-sheet-items", selectedSheetId] });
    },
    onError: (e) => {
      toast.error(errorToMessage(e) || "Eroare la ștergere linie");
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Liste speciale de preț</h1>
          <p className="text-muted-foreground">Import și utilizare în ofertare și rețete</p>
        </div>

        {!isAdmin && (
          <div className="text-sm text-muted-foreground">
            Contul curent nu are rol admin, deci nu poate seta lista activă.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Creează listă</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="md:col-span-2">
                <Label>Nume</Label>
                <Input value={newSheetName} onChange={(e) => setNewSheetName(e.target.value)} placeholder="ex: Swiss Krono OSB 2026-04" />
              </div>
              <div>
                <Label>Sursă</Label>
                <Input value={newSheetSource} onChange={(e) => setNewSheetSource(e.target.value)} placeholder="WhatsApp / Email" />
              </div>
              <div>
                <Label>Data primire</Label>
                <Input type="date" value={newSheetReceivedAt} onChange={(e) => setNewSheetReceivedAt(e.target.value)} />
              </div>
            </div>
            <div className="mt-4">
              <Button onClick={() => createSheetMutation.mutate()} disabled={createSheetMutation.isPending}>
                <Plus className="h-4 w-4 mr-2" />
                Creează
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Liste existente</CardTitle>
          </CardHeader>
          <CardContent>
            {sheetsLoading ? (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : sheets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nu există liste.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sheets.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSheetId(s.id)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      selectedSheetId === s.id ? "border-primary bg-primary/5" : "hover:bg-accent/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {s.source || "—"} {s.received_at ? `• ${s.received_at}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.active && <CheckCircle2 className="h-4 w-4 text-primary" />}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            activateSheetMutation.mutate(s.id);
                          }}
                          disabled={activateSheetMutation.isPending || s.active || !isAdmin}
                        >
                          Setează activă
                        </Button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedSheet && (
          <Card>
            <CardHeader>
              <CardTitle>Linii listă: {selectedSheet.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-end">
                <div className="lg:col-span-2">
                  <Label>Produs</Label>
                  <div className="flex items-center gap-2">
                    <ProductPicker
                      onSelect={(p) => {
                        setNewItemProduct(p);
                        setNewItemUnit(p.unit || "");
                      }}
                      trigger={<Button variant="outline">Selectează produs</Button>}
                    />
                    <div className="text-sm text-muted-foreground truncate flex-1">
                      {newItemProduct ? `${newItemProduct.cod_intern} — ${newItemProduct.denumire_completa}` : "Neselectat"}
                    </div>
                  </div>
                </div>
                <div>
                  <Label>Etichetă (opțional)</Label>
                  <Input value={newItemLabel} onChange={(e) => setNewItemLabel(e.target.value)} placeholder="ex: fracții / 1-3 paleți" />
                </div>
                <div>
                  <Label>UM</Label>
                  <Input value={newItemUnit} onChange={(e) => setNewItemUnit(e.target.value)} placeholder="buc / mp / sac" />
                </div>
                <div>
                  <Label>Preț</Label>
                  <div className="flex gap-2">
                    <Input value={newItemPrice} onChange={(e) => setNewItemPrice(e.target.value)} placeholder="0.00" />
                    <Button onClick={() => addItemMutation.mutate()} disabled={addItemMutation.isPending}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-md border">
                <Table className="min-w-[1000px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cod</TableHead>
                      <TableHead>Produs</TableHead>
                      <TableHead className="w-[180px]">Etichetă</TableHead>
                      <TableHead className="w-[80px]">UM</TableHead>
                      <TableHead className="w-[110px] text-right">Preț</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
                        </TableCell>
                      </TableRow>
                    ) : items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Nicio linie.
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="font-mono text-xs">{it.products?.cod_intern || "—"}</TableCell>
                          <TableCell className="max-w-[520px] truncate">{it.products?.denumire_completa || it.product_id}</TableCell>
                          <TableCell>
                            <Input
                              defaultValue={it.label || ""}
                              onBlur={(e) => {
                                const label = e.target.value.trim() || null;
                                if (label === it.label) return;
                                updateItemMutation.mutate({ id: it.id, label, unit: it.unit, price: Number(it.price) });
                              }}
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              defaultValue={it.unit || ""}
                              onBlur={(e) => {
                                const unit = e.target.value.trim() || null;
                                if (unit === it.unit) return;
                                updateItemMutation.mutate({ id: it.id, label: it.label, unit, price: Number(it.price) });
                              }}
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              defaultValue={String(it.price)}
                              onBlur={(e) => {
                                const priceNum = Number(e.target.value);
                                if (!Number.isFinite(priceNum) || priceNum <= 0) return;
                                if (priceNum === Number(it.price)) return;
                                updateItemMutation.mutate({ id: it.id, label: it.label, unit: it.unit, price: priceNum });
                              }}
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => deleteItemMutation.mutate(it.id)}
                              disabled={deleteItemMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminPriceSheets;
