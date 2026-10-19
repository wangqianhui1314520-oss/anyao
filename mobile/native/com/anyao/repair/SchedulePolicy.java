package com.anyao.repair;

import org.json.*;
import java.lang.reflect.*;
import java.time.*;
import java.util.*;

/** Replaces only Store.schedule; Store still owns locking, persistence and alarms. */
public final class SchedulePolicy {
    private SchedulePolicy() {}
    private static Object call(Object s,String name) throws Exception {Method m=s.getClass().getDeclaredMethod(name);m.setAccessible(true);return m.invoke(s);}
    private static JSONObject db(Object s) throws Exception {Field f=s.getClass().getDeclaredField("db");f.setAccessible(true);return (JSONObject)f.get(s);}
    private static JSONObject config(JSONObject drug) throws JSONException {
        return new JSONObject().put("times",new JSONArray(drug.optJSONArray("times")==null?"[]":drug.getJSONArray("times").toString()))
            .put("weekdays",DrugPolicy.weekdays(drug.has("weekdays")?drug.get("weekdays"):new JSONArray("[1,2,3,4,5,6,7]")))
            .put("asNeeded",drug.optBoolean("asNeeded")).put("doseQuantity",drug.optDouble("doseQuantity",1))
            .put("timeQuantities",new JSONObject(drug.optJSONObject("timeQuantities")==null?"{}":drug.getJSONObject("timeQuantities").toString()));
    }
    private static String signature(JSONObject c) throws JSONException {
        JSONArray times=c.optJSONArray("times");StringBuilder b=new StringBuilder(c.optBoolean("asNeeded")+":"+c.optJSONArray("weekdays"));
        if(times!=null)for(int i=0;i<times.length();i++){String t=times.getString(i);b.append('|').append(t).append(':').append(DrugPolicy.quantity(c,t));}return b.toString();
    }
    private static String created(JSONObject d,String today){try{return Instant.parse(d.getString("at")).atZone(ZoneId.of("Asia/Shanghai")).toLocalDate().toString();}catch(Exception e){return today;}}
    private static boolean contains(JSONArray a,String t){if(a!=null)for(int i=0;i<a.length();i++)if(t.equals(a.optString(i)))return true;return false;}
    private static JSONObject on(JSONObject d,String day) {
        JSONArray a=d.optJSONArray("scheduleRevisions");JSONObject found=d;
        if(a!=null)for(int i=0;i<a.length();i++){JSONObject r=a.optJSONObject(i);if(r!=null&&r.optString("from").compareTo(day)<=0)found=r;}
        return found;
    }
    public static java.util.List<JSONObject> doses(Object store,java.util.List<JSONObject> doses) throws Exception {
        JSONObject db=db(store);Map<String,JSONObject> drugs=new HashMap<>(),events=new HashMap<>();
        JSONArray ds=db.getJSONArray("drugs"),es=db.getJSONArray("intakeEvents");
        for(int i=0;i<ds.length();i++)drugs.put(ds.getJSONObject(i).getString("id"),ds.getJSONObject(i));
        for(int i=0;i<es.length();i++)events.put(es.getJSONObject(i).getString("id"),es.getJSONObject(i));
        for(JSONObject dose:doses){JSONObject d=drugs.get(dose.optString("drugId")),e=events.get(dose.optString("eventId"));
            if(d==null)continue;double q=e!=null&&e.has("plannedQuantity")?e.getDouble("plannedQuantity"):DrugPolicy.quantity(d,dose.optString("planned"));String unit=d.optString("inventoryUnit","片");
            dose.put("plannedQuantity",q).put("inventoryUnit",unit);JSONObject drug=dose.optJSONObject("drug");
            if(drug!=null)drug.put("dose",d.optString("dose")+(d.optString("dose").isEmpty()?"":" · ")+"本次 "+java.math.BigDecimal.valueOf(q).stripTrailingZeros().toPlainString()+" "+unit);
        }
        return doses;
    }
    public static boolean schedule(Object store) throws Exception {
        JSONObject db=db(store),meta=db.getJSONObject("meta");String today=(String)call(store,"today");LocalDate date=LocalDate.parse(today);
        boolean changed=false;Map<String,JSONObject> drugs=new LinkedHashMap<>();
        JSONArray all=db.getJSONArray("drugs");
        for(int i=0;i<all.length();i++){
            JSONObject d=all.getJSONObject(i);drugs.put(d.getString("id"),d);JSONObject current=config(d);JSONArray revisions=d.optJSONArray("scheduleRevisions");
            if(revisions==null||revisions.length()==0){revisions=new JSONArray().put(current.put("from",created(d,today)));d.put("scheduleRevisions",revisions);changed=true;}
            else if(!signature(revisions.getJSONObject(revisions.length()-1)).equals(signature(current))){
                current.put("from",today);
                // The last revision can be in the future after a clock change/restore.
                while(revisions.length()>0&&revisions.getJSONObject(revisions.length()-1).getString("from").compareTo(today)>=0)revisions.remove(revisions.length()-1);
                revisions.put(current);changed=true;
            }
            // Backfill is bounded to 31 days; retain the revision immediately preceding it.
            while(revisions.length()>2&&revisions.getJSONObject(1).getString("from").compareTo(date.minusDays(32).toString())<0){revisions.remove(0);changed=true;}
        }
        JSONArray old=db.getJSONArray("intakeEvents"),events=new JSONArray();Set<String> keys=new HashSet<>();
        for(int i=0;i<old.length();i++){
            JSONObject e=old.getJSONObject(i),d=drugs.get(e.optString("drugId"));String day=e.optString("date"),time=e.optString("scheduleTime",e.optString("time")),status=e.optString("status");
            boolean pending=!status.equals("taken")&&!status.equals("skipped")&&!e.optBoolean("asNeeded");
            if(pending&&day.compareTo(today)>=0&&d!=null){
                JSONObject c=on(d,day);int weekday=LocalDate.parse(day).getDayOfWeek().getValue();
                if(c.optBoolean("asNeeded")||!DrugPolicy.selected(c,weekday)||!contains(c.optJSONArray("times"),time)){changed=true;continue;}
                double q=DrugPolicy.quantity(c,time);if(e.optDouble("plannedQuantity",-1)!=q){e.put("plannedQuantity",q);changed=true;}
            }
            events.put(e);keys.add(e.optString("drugId")+"|"+day+"|"+time);
        }
        String last=meta.optString("lastScheduled",today);List<String> days=new ArrayList<>();
        for(int i=31;i>0;i--){String day=date.minusDays(i).toString();if(day.compareTo(last)>0)days.add(day);}days.add(today);
        for(JSONObject d:drugs.values())for(String day:days){
            if(day.compareTo(created(d,today))<0)continue;JSONObject c=on(d,day);
            if(c.optBoolean("asNeeded")||!DrugPolicy.selected(c,LocalDate.parse(day).getDayOfWeek().getValue()))continue;
            JSONArray times=c.optJSONArray("times");if(times==null)continue;
            for(int i=0;i<times.length();i++){
                String t=times.getString(i),key=d.getString("id")+"|"+day+"|"+t;if(!keys.add(key))continue;
                events.put(new JSONObject().put("id","i_"+UUID.randomUUID().toString().replace("-","").substring(0,12)).put("drugId",d.getString("id"))
                    .put("date",day).put("time",t).put("scheduleTime",t).put("status","scheduled").put("plannedQuantity",DrugPolicy.quantity(c,t)));changed=true;
            }
        }
        if(events.length()>20000){List<JSONObject> sorted=new ArrayList<>();for(int i=0;i<events.length();i++)sorted.add(events.getJSONObject(i));sorted.sort(Comparator.comparing(e->e.optString("date")));events=new JSONArray();for(int i=sorted.size()-20000;i<sorted.size();i++)events.put(sorted.get(i));changed=true;}
        if(!today.equals(meta.optString("lastScheduled"))){meta.put("lastScheduled",today);changed=true;}
        db.put("intakeEvents",events);if(changed)call(store,"save");return changed;
    }
}
