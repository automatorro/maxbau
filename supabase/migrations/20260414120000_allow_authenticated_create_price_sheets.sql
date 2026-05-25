CREATE POLICY "Authenticated users can create price sheets"
  ON public.price_sheets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert price sheet items"
  ON public.price_sheet_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update price sheet items"
  ON public.price_sheet_items FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete price sheet items"
  ON public.price_sheet_items FOR DELETE
  TO authenticated
  USING (true);
