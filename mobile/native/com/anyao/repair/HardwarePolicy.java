package com.anyao.repair;
import org.json.*;

/** Reject unsupported recurrence before the original native writer clears any compartment. */
public final class HardwarePolicy {
    private HardwarePolicy() {}
    public static void plans(JSONArray plans) throws JSONException {
        if(plans==null)return; // Coroutine resume; the original request was checked on entry.
        for(int i=0;i<plans.length();i++){
            JSONObject p=plans.getJSONObject(i);
            if(p.has("weekdays")&&DrugPolicy.weekdays(p.get("weekdays")).length()!=7)
                throw new IllegalArgumentException("本台药盒的星期位映射尚未验证，不能把非每日计划当成每天写入。手机已保存星期计划；此次药盒计划未改动。");
        }
    }
}
