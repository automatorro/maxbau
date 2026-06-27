import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Catalog from "./pages/Catalog";
import ProductDetail from "./pages/ProductDetail";
import NewQuote from "./pages/NewQuote";
import MyQuotes from "./pages/MyQuotes";
import AdminProducts from "./pages/AdminProducts";
import AdminDiscounts from "./pages/AdminDiscounts";

import ImportOcr from "./pages/ImportOcr";
import RecipeQuote from "./pages/RecipeQuote";
import SmartQuote from "./pages/SmartQuote";

import Consultant from "./pages/Consultant";
import AntemasuratorImport from "./pages/AntemasuratorImport";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/catalog" element={<ProtectedRoute><Catalog /></ProtectedRoute>} />
            <Route path="/catalog/product/:id" element={<ProtectedRoute><ProductDetail /></ProtectedRoute>} />
            <Route path="/import" element={<ProtectedRoute><ImportOcr /></ProtectedRoute>} />
            <Route path="/quote/new" element={<ProtectedRoute><NewQuote /></ProtectedRoute>} />
            <Route path="/quote/:id/edit" element={<ProtectedRoute><NewQuote /></ProtectedRoute>} />
            <Route path="/recipe-quote" element={<ProtectedRoute><RecipeQuote /></ProtectedRoute>} />
            <Route path="/quote/smart" element={<ProtectedRoute><SmartQuote /></ProtectedRoute>} />
            <Route path="/wool-configurator" element={<ProtectedRoute><RecipeQuote /></ProtectedRoute>} />
            <Route path="/quotes" element={<ProtectedRoute><MyQuotes /></ProtectedRoute>} />
            <Route path="/quote" element={<Navigate to="/quotes" replace />} />
            <Route path="/admin/products" element={<AdminRoute><AdminProducts /></AdminRoute>} />
            <Route path="/admin/discounts" element={<AdminRoute><AdminDiscounts /></AdminRoute>} />

            <Route path="/consultant" element={<ProtectedRoute><Consultant /></ProtectedRoute>} />
            <Route path="/quote/antemasuratori" element={<ProtectedRoute><AntemasuratorImport /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
