package com.anyao.repair;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Arrays;

/** Stock quantities use the selected stock unit, never a parsed dose description. */
public final class InventoryPolicy {
    private InventoryPolicy() {}
    private static final String[] UNITS = {"片", "粒", "袋", "支", "瓶", "毫升", "滴", "单位"};
    private static BigDecimal number(Object raw, boolean positive) {
        if (!(raw instanceof Number)) throw new IllegalArgumentException("invalid_doseQuantity");
        BigDecimal n;
        try { n = new BigDecimal(raw.toString()).stripTrailingZeros(); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("invalid_doseQuantity"); }
        if (n.signum() < (positive ? 1 : 0) || n.compareTo(new BigDecimal(positive ? "100000" : "1000000000000")) > 0 || n.scale() > 3)
            throw new IllegalArgumentException("invalid_doseQuantity");
        return n;
    }
    public static JSONObject fields(JSONObject input, JSONObject output, boolean partial) throws JSONException {
        if (input.has("inventory")) {
            try { output.put("inventory", stock(input).doubleValue()); }
            catch (IllegalArgumentException e) { throw new IllegalArgumentException("invalid_inventory"); }
        }
        if (input.has("doseQuantity") || !partial) {
            BigDecimal quantity = number(input.has("doseQuantity") ? input.get("doseQuantity") : 1, true);
            output.put("doseQuantity", quantity.doubleValue());
        }
        if (input.has("inventoryUnit") || !partial) {
            Object unit = input.has("inventoryUnit") ? input.get("inventoryUnit") : "片";
            if (!(unit instanceof String) || !Arrays.asList(UNITS).contains(unit))
                throw new IllegalArgumentException("invalid_inventoryUnit");
            output.put("inventoryUnit", unit);
        }
        return DrugPolicy.fields(input,output,partial);
    }
    private static BigDecimal quantity(JSONObject drug) throws JSONException {
        return number(drug.has("doseQuantity") ? drug.get("doseQuantity") : 1, true);
    }
    private static BigDecimal stock(JSONObject drug) throws JSONException {
        Object raw = drug.has("inventory") ? drug.get("inventory") : 0;
        // Legacy refills used double addition (for example 0.1 + 0.2).
        if (raw instanceof Number) {
            BigDecimal value = new BigDecimal(raw.toString()), rounded = value.setScale(3, RoundingMode.HALF_UP);
            if (value.subtract(rounded).abs().compareTo(new BigDecimal("0.00000001")) < 0) raw = rounded;
        }
        return number(raw, false);
    }
    public static void refill(JSONObject drug, double amount) throws JSONException {
        BigDecimal addition;
        try { addition = number(amount, true); }
        catch (IllegalArgumentException e) { throw new IllegalArgumentException("invalid_amount"); }
        BigDecimal next = stock(drug).add(addition);
        number(next, false);
        drug.put("inventory", next.doubleValue());
    }
    public static void refillReceipt(JSONObject drug, JSONObject receipt) throws JSONException {
        receipt.put("inventoryUnit", drug.optString("inventoryUnit", "片"));
    }
    public static void take(JSONObject drug, JSONObject event) throws JSONException {
        String planned=event.optString("scheduleTime",event.optString("time"));
        BigDecimal amount = event.has("plannedQuantity") ? number(event.get("plannedQuantity"),true) : number(DrugPolicy.quantity(drug,planned),true), available = stock(drug);
        boolean deducted = available.compareTo(amount) >= 0;
        if (deducted) drug.put("inventory", available.subtract(amount).doubleValue());
        event.put("inventoryDeducted", deducted).put("inventoryDeductedAmount", deducted ? amount.doubleValue() : 0);
        event.put("inventoryUnit", drug.optString("inventoryUnit", "片"));
    }
    public static void transition(JSONObject drug, JSONObject event, String status) throws JSONException {
        boolean wasTaken = "taken".equals(event.optString("status")), taking = "taken".equals(status);
        if (taking && !wasTaken) {
            if (drug != null) take(drug, event);
            else event.put("inventoryDeducted", false).put("inventoryDeductedAmount", 0);
        } else if (!taking && wasTaken && event.optBoolean("inventoryDeducted", true)) {
            // Old records deducted exactly one. Edits to the present dose cannot change this receipt.
            BigDecimal amount = number(event.has("inventoryDeductedAmount") ? event.get("inventoryDeductedAmount") : 1, false);
            if (drug != null && !event.optString("inventoryUnit", "片").equals(drug.optString("inventoryUnit", "片")))
                throw new IllegalArgumentException("库存单位已变化，请先恢复原库存单位再撤销服药记录");
            if (drug != null) drug.put("inventory", stock(drug).add(amount).doubleValue());
            event.put("inventoryDeducted", false).put("inventoryDeductedAmount", 0);
        }
    }
    public static JSONObject restore(JSONObject backup) throws JSONException {
        JSONArray drugs = backup.optJSONArray("drugs");
        if (drugs != null) for (int i = 0; i < drugs.length(); i++) {
            JSONObject d = drugs.getJSONObject(i); fields(d, new JSONObject(), true); stock(d); DrugPolicy.validateDrug(d);
        }
        JSONArray events = backup.optJSONArray("intakeEvents");
        if (events != null) for (int i = 0; i < events.length(); i++) {
            JSONObject e = events.getJSONObject(i);
            if (e.has("inventoryDeductedAmount")) number(e.get("inventoryDeductedAmount"), false);
            if (e.has("plannedQuantity")) number(e.get("plannedQuantity"), true);
        }
        return backup;
    }
}
