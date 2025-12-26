import { useEffect, useMemo, useState } from "react";
import * as api from "../services/api.js";
import { Button } from "../assets/ui/button.jsx";
import { Input } from "../assets/ui/input.jsx";
import { Label } from "../assets/ui/label.jsx";

const toNumberOrEmpty = (value) => {
  if (value === null || value === undefined) {
    return "";
  }
  const parsed = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "";
  }
  return String(parsed);
};

const ModifyExitPlanForm = ({ holding, onClose, onSuccess }) => {
  const symbol = holding?.symbol;
  const productType = holding?.product_type || "CNC";

  const existingPlan = holding?.exit_plan || null;
  const hasExistingPlan = Boolean(existingPlan?.stop_order_id || existingPlan?.target_order_id);

  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setStopLoss(toNumberOrEmpty(existingPlan?.stop_loss_price));
    setTarget(toNumberOrEmpty(existingPlan?.target_price));
    setError(null);
  }, [existingPlan?.stop_loss_price, existingPlan?.target_price, symbol]);

  const canSubmit = useMemo(() => {
    if (!symbol) {
      return false;
    }

    const sl = stopLoss ? parseFloat(stopLoss) : NaN;
    const tg = target ? parseFloat(target) : NaN;

    if (!Number.isFinite(sl) || sl <= 0) {
      return false;
    }
    if (!Number.isFinite(tg) || tg <= 0) {
      return false;
    }

    return true;
  }, [hasExistingPlan, stopLoss, symbol, target]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!canSubmit) {
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        symbol,
        product_type: productType,
        stop_order_id: existingPlan?.stop_order_id || undefined,
        target_order_id: existingPlan?.target_order_id || undefined,
        stop_loss_price: parseFloat(stopLoss),
        target_price: parseFloat(target),
      };

      const result = await api.updateExitPlan(payload);
      if (!result?.success) {
        throw new Error(result?.message || "Unable to update exit plan.");
      }

      onSuccess?.(result);
      onClose?.();
    } catch (err) {
      setError(err?.message || "Unable to update exit plan.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!hasExistingPlan && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No exit plan exists yet for this holding. Set stoploss and target below to create one.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="exit-stoploss">Stoploss</Label>
          <Input
            id="exit-stoploss"
            inputMode="decimal"
            placeholder="e.g. 2450"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            disabled={isSaving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="exit-target">Target</Label>
          <Input
            id="exit-target"
            inputMode="decimal"
            placeholder="e.g. 2750"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={isSaving}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit || isSaving}>
          {isSaving ? "Saving..." : (hasExistingPlan ? "Update" : "Create")}
        </Button>
      </div>
    </form>
  );
};

export default ModifyExitPlanForm;
