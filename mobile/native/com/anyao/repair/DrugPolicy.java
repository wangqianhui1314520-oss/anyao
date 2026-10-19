package com.anyao.repair;

import org.json.*;
import java.util.*;

/** Extra drug fields are validated by the native store as well as by the form. */
public final class DrugPolicy {
    private DrugPolicy() {}
    public static JSONArray weekdays(Object raw) throws JSONException {
        if (!(raw instanceof JSONArray)) throw new IllegalArgumentException("invalid_weekdays");
        JSONArray a=(JSONArray)raw, out=new JSONArray(); TreeSet<Integer> days=new TreeSet<>();
        if(a.length()<1||a.length()>7)throw new IllegalArgumentException("invalid_weekdays");
        for(int i=0;i<a.length();i++){
            Object v=a.get(i);
            if(!(v instanceof Number)||((Number)v).doubleValue()!=((Number)v).intValue())throw new IllegalArgumentException("invalid_weekdays");
            int n=((Number)v).intValue();if(n<1||n>7||!days.add(n))throw new IllegalArgumentException("invalid_weekdays");
        }
        for(int d:days)out.put(d);return out;
    }
    public static boolean selected(JSONObject d,int isoDay) {
        JSONArray a=d.optJSONArray("weekdays");if(a==null)return true;
        for(int i=0;i<a.length();i++)if(a.optInt(i)==isoDay)return true;return false;
    }
    public static double quantity(JSONObject d,String time) {
        JSONObject quantities=d.optJSONObject("timeQuantities");
        return quantities!=null&&quantities.has(time)?quantities.optDouble(time):d.optDouble("doseQuantity",1);
    }
    public static JSONObject fields(JSONObject in,JSONObject out,boolean partial) throws JSONException {
        for(String k:new String[]{"category","barcode"})if(in.has(k)||!partial){
            Object v=in.has(k)?in.get(k):"";
            if(!(v instanceof String))throw new IllegalArgumentException("invalid_"+k);
            String s=((String)v).trim();
            if(k.equals("category")?(s.length()>24||s.matches("(?s).*[\\p{Cntrl}].*")):(!s.isEmpty()&&!s.matches("[A-Za-z0-9][A-Za-z0-9._-]{3,63}")))throw new IllegalArgumentException("invalid_"+k);
            out.put(k,s);
        }
        if(in.has("weekdays")||!partial)out.put("weekdays",weekdays(in.has("weekdays")?in.get("weekdays"):new JSONArray("[1,2,3,4,5,6,7]")));
        if(in.has("timeQuantities")||!partial){
            Object v=in.has("timeQuantities")?in.get("timeQuantities"):new JSONObject();
            if(!(v instanceof JSONObject))throw new IllegalArgumentException("invalid_timeQuantities");
            JSONObject q=(JSONObject)v, clean=new JSONObject();
            if(q.length()>24)throw new IllegalArgumentException("invalid_timeQuantities");
            Iterator<String> keys=q.keys();while(keys.hasNext()){
                String key=keys.next();Object n=q.get(key);
                if(!key.matches("([01][0-9]|2[0-3]):[0-5][0-9]")||!(n instanceof Number))throw new IllegalArgumentException("invalid_timeQuantities");
                double x=((Number)n).doubleValue();
                if(!Double.isFinite(x)||x<=0||x>100000||Math.abs(x*1000-Math.rint(x*1000))>0.000001)throw new IllegalArgumentException("invalid_timeQuantities");
                clean.put(key,x);
            }
            out.put("timeQuantities",clean);
        }
        return out;
    }
    public static void validateDrug(JSONObject d) throws JSONException {
        fields(d,new JSONObject(),true);
        JSONArray revisions=d.optJSONArray("scheduleRevisions");
        if(d.has("scheduleRevisions")&&revisions==null)throw new IllegalArgumentException("invalid_scheduleRevisions");
        if(revisions!=null){
            if(revisions.length()>100)throw new IllegalArgumentException("invalid_scheduleRevisions");
            String previous="";
            for(int i=0;i<revisions.length();i++){
                JSONObject r=revisions.getJSONObject(i);String date=r.getString("from");
                try{java.time.LocalDate.parse(date);}catch(Exception e){throw new IllegalArgumentException("invalid_scheduleRevisions");}
                if(date.compareTo(previous)<=0)throw new IllegalArgumentException("invalid_scheduleRevisions");previous=date;
                fields(r,new JSONObject(),true);JSONArray times=r.getJSONArray("times");
                for(int j=0;j<times.length();j++)if(!times.getString(j).matches("([01][0-9]|2[0-3]):[0-5][0-9]"))throw new IllegalArgumentException("invalid_times");
                JSONObject tmp=new JSONObject();InventoryPolicy.fields(new JSONObject().put("doseQuantity",r.opt("doseQuantity")),tmp,true);
            }
        }
    }
}
