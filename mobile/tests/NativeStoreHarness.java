import dalvik.system.PathClassLoader;
import java.io.File;
import java.lang.reflect.*;
import org.json.*;

/** Runs the actual APK's Store under Android ART with a new isolated fixture file. */
public final class NativeStoreHarness {
    static Object store;
    static Method handle;
    static final JSONArray results = new JSONArray();
    static final java.util.concurrent.atomic.AtomicLong now=new java.util.concurrent.atomic.AtomicLong(java.time.Instant.parse("2026-10-12T00:00:00Z").toEpochMilli());
    static void day(String date){now.set(java.time.Instant.parse(date+"T00:00:00Z").toEpochMilli());}
    static JSONArray doses(String id) throws Exception {
        JSONArray a=((JSONObject)api("GET","doses",new JSONObject())).getJSONArray("doses"),out=new JSONArray();
        for(int i=0;i<a.length();i++)if(id.equals(a.getJSONObject(i).optString("drugId")))out.put(a.getJSONObject(i));return out;
    }
    static Object response(String method, String path, JSONObject body, int expected) throws Exception {
        Object r = handle.invoke(store, method, "/api/" + path, body);
        int status = (Integer) r.getClass().getMethod("getStatus").invoke(r);
        Object data = r.getClass().getMethod("getBody").invoke(r);
        if (expected == 0 ? status < 200 || status >= 300 : status != expected) throw new AssertionError(path + ": " + status + " " + data);
        return data;
    }
    static Object api(String method, String path, JSONObject body) throws Exception {return response(method,path,body,0);}
    static JSONObject obj(String text) throws Exception {return new JSONObject(text);}
    static JSONObject drug(String id) throws Exception {
        JSONArray drugs = (JSONArray) api("GET", "drugs", new JSONObject());
        for(int i=0;i<drugs.length();i++)if(id.equals(drugs.getJSONObject(i).getString("id")))return drugs.getJSONObject(i);
        throw new AssertionError("missing drug");
    }
    static JSONObject event(String id, String status) throws Exception {
        return (JSONObject) api("PATCH","intake-events/"+id,obj("{status:'"+status+"',time:'07:30'}"));
    }
    static void eq(double actual,double expected) {if(Math.abs(actual-expected)>0.000001)throw new AssertionError(actual+" != "+expected);}
    interface Check {void run() throws Exception;}
    static void test(String name,Check check) throws Exception {
        try {check.run();results.put(new JSONObject().put("name",name).put("status","PASS"));}
        catch(Throwable e) {results.put(new JSONObject().put("name",name).put("status","FAIL").put("detail",e.toString()));throw e;}
    }
    public static void main(String[] args) throws Exception {
        try {
            PathClassLoader loader = new PathClassLoader(args[0],NativeStoreHarness.class.getClassLoader());
            for(String name:new String[]{"Store","MainActivity","Reminders"})Class.forName("com.anyao.app."+name,true,loader).getDeclaredMethods();
            for(String name:new String[]{"BarcodeActivity","BarcodeDecoder","AlarmDispatchService"})Class.forName("com.anyao.repair."+name,true,loader).getDeclaredMethods();
            results.put(new JSONObject().put("name","ART loads patched native classes").put("status","PASS"));
            Class<?> cls=Class.forName("com.anyao.app.Store",true,loader),fn=Class.forName("kotlin.jvm.functions.Function0",true,loader);
            Object clock=Proxy.newProxyInstance(loader,new Class<?>[]{fn},(proxy,m,a)->now.get());
            store=cls.getConstructor(File.class,fn).newInstance(new File(args[1]),clock);
            handle=cls.getMethod("handle",String.class,String.class,JSONObject.class);
            JSONObject d=(JSONObject)api("POST","drugs",obj("{name:'native fixture',dose:'100mg',doseQuantity:2,inventoryUnit:'片',inventory:20,times:['23:59']}"));
            String id=d.getString("id");
            test("quantity and unit persist through native API",()->{eq(drug(id).getDouble("doseQuantity"),2);if(!"片".equals(drug(id).getString("inventoryUnit")))throw new AssertionError();});
            JSONArray events=(JSONArray)api("GET","intake-events?all=true",new JSONObject());
            String eid=events.getJSONObject(0).getString("id");
            test("20 units minus 2 units per intake equals 18",()->{event(eid,"taken");eq(drug(id).getDouble("inventory"),18);});
            test("repeated taken action is idempotent",()->{event(eid,"taken");eq(drug(id).getDouble("inventory"),18);});
            test("undo refunds the receipt after dose quantity changes",()->{api("PATCH","drugs/"+id,obj("{doseQuantity:3}"));event(eid,"scheduled");eq(drug(id).getDouble("inventory"),20);});
            JSONObject needed=(JSONObject)api("POST","drugs",obj("{name:'as needed fixture',doseQuantity:2,inventoryUnit:'粒',asNeeded:true,times:[],inventory:20}"));
            String nid=needed.getString("id");
            test("as-needed intake uses structured quantity",()->{api("POST","intake-events",obj("{drugId:'"+nid+"'}"));eq(drug(nid).getDouble("inventory"),18);});
            JSONObject small=(JSONObject)api("POST","drugs",obj("{name:'low stock fixture',doseQuantity:2,inventory:1,asNeeded:true,times:[]}"));
            String sid=small.getString("id");
            test("insufficient stock stays nonnegative and undo adds nothing",()->{
                JSONObject e=(JSONObject)api("POST","intake-events",obj("{drugId:'"+sid+"'}"));
                if(e.getBoolean("inventoryDeducted"))throw new AssertionError();eq(drug(sid).getDouble("inventory"),1);
                event(e.getString("id"),"scheduled");eq(drug(sid).getDouble("inventory"),1);
            });
            JSONObject liquid=(JSONObject)api("POST","drugs",obj("{name:'liquid fixture',doseQuantity:1.25,inventoryUnit:'毫升',inventory:10.5,asNeeded:true,times:[]}"));
            String lid=liquid.getString("id");
            test("decimal refill preserves exact stock and receipt unit",()->{
                JSONObject decimal=(JSONObject)api("POST","drugs",obj("{name:'decimal refill fixture',doseQuantity:0.1,inventoryUnit:'毫升',inventory:0.1,asNeeded:true,times:[]}"));
                String did=decimal.getString("id");
                JSONObject refill=(JSONObject)api("POST","drugs/"+did+"/refill",obj("{amount:0.2}"));
                eq(drug(did).getDouble("inventory"),0.3);
                if(!"毫升".equals(refill.getString("inventoryUnit")))throw new AssertionError();
                JSONObject e=(JSONObject)api("POST","intake-events",obj("{drugId:'"+did+"'}"));eq(drug(did).getDouble("inventory"),0.2);
                event(e.getString("id"),"scheduled");eq(drug(did).getDouble("inventory"),0.3);
                response("POST","drugs/"+did+"/refill",obj("{amount:0.0001}"),400);eq(drug(did).getDouble("inventory"),0.3);
            });
            test("decimal quantity conserves stock on take and undo",()->{
                JSONObject e=(JSONObject)api("POST","intake-events",obj("{drugId:'"+lid+"'}"));eq(drug(lid).getDouble("inventory"),9.25);
                event(e.getString("id"),"scheduled");eq(drug(lid).getDouble("inventory"),10.5);
            });
            test("zero quantity is rejected by native API",()->response("PATCH","drugs/"+id,obj("{doseQuantity:0}"),400));
            test("invalid stock unit is rejected by native API",()->response("PATCH","drugs/"+id,obj("{inventoryUnit:'unknown'}"),400));
            test("backup and restore retain quantity and stock unit",()->{
                JSONObject backup=(JSONObject)api("GET","export",new JSONObject());api("PATCH","drugs/"+id,obj("{doseQuantity:4}"));
                api("POST","restore",backup);eq(drug(id).getDouble("doseQuantity"),3);
                if(!"毫升".equals(drug(lid).getString("inventoryUnit")))throw new AssertionError();
            });
            test("invalid quantity in backup is rejected",()->{
                JSONObject backup=(JSONObject)api("GET","export",new JSONObject());backup.getJSONArray("drugs").getJSONObject(0).put("doseQuantity",-2);
                response("POST","restore",backup,400);eq(drug(id).getDouble("doseQuantity"),3);
            });
            test("legacy receipt refunds one after current dose is changed",()->{
                JSONObject backup=(JSONObject)api("GET","export",new JSONObject());
                JSONArray rows=backup.getJSONArray("intakeEvents");
                for(int i=0;i<rows.length();i++){JSONObject e=rows.getJSONObject(i);if(eid.equals(e.getString("id"))){e.put("status","taken").put("inventoryDeducted",true);e.remove("inventoryDeductedAmount");e.remove("inventoryUnit");}}
                JSONArray drugs=backup.getJSONArray("drugs");for(int i=0;i<drugs.length();i++)if(id.equals(drugs.getJSONObject(i).getString("id")))drugs.getJSONObject(i).put("inventory",19);
                api("POST","restore",backup);event(eid,"scheduled");eq(drug(id).getDouble("inventory"),20);
            });
            JSONObject weekly=(JSONObject)api("POST","drugs",obj("{name:'weekday fixture',category:'常用药',barcode:'6901234567892',weekdays:[1,3,5],times:['08:00','20:00'],doseQuantity:1,timeQuantities:{'08:00':0.5,'20:00':2},inventory:20}"));
            String wid=weekly.getString("id");
            test("category, barcode, weekdays and per-time quantities persist",()->{
                JSONObject w=drug(wid);if(!"常用药".equals(w.getString("category"))||!"6901234567892".equals(w.getString("barcode")))throw new AssertionError();
                if(!"[1,3,5]".equals(w.getJSONArray("weekdays").toString()))throw new AssertionError();eq(w.getJSONObject("timeQuantities").getDouble("08:00"),0.5);
            });
            test("selected Monday has two planned quantities and timed stock deductions",()->{
                JSONArray a=doses(wid);if(a.length()!=2)throw new AssertionError(a.toString());eq(a.getJSONObject(0).getDouble("plannedQuantity"),0.5);eq(a.getJSONObject(1).getDouble("plannedQuantity"),2);
                event(a.getJSONObject(0).getString("eventId"),"taken");eq(drug(wid).getDouble("inventory"),19.5);
                event(a.getJSONObject(1).getString("eventId"),"taken");eq(drug(wid).getDouble("inventory"),17.5);
            });
            test("unselected Tuesday produces no doses, completed Monday retained",()->{
                day("2026-10-13");if(doses(wid).length()!=0)throw new AssertionError();
                JSONArray a=(JSONArray)api("GET","intake-events?all=true",new JSONObject());int n=0;
                for(int i=0;i<a.length();i++)if(wid.equals(a.getJSONObject(i).optString("drugId"))&&"taken".equals(a.getJSONObject(i).optString("status")))n++;
                if(n!=2)throw new AssertionError("lost completed history");
            });
            test("backfill after absence adds only selected weekdays",()->{
                day("2026-10-17");if(doses(wid).length()!=0)throw new AssertionError();
                JSONArray a=(JSONArray)api("GET","intake-events?all=true",new JSONObject());java.util.Set<String> dates=new java.util.HashSet<>();
                for(int i=0;i<a.length();i++)if(wid.equals(a.getJSONObject(i).optString("drugId")))dates.add(a.getJSONObject(i).getString("date"));
                if(!dates.equals(new java.util.HashSet<>(java.util.Arrays.asList("2026-10-12","2026-10-14","2026-10-16"))))throw new AssertionError(dates.toString());
            });
            test("weekday-only edit schedules today and cancels it when deselected",()->{
                api("PATCH","drugs/"+wid,obj("{weekdays:[6]}"));if(doses(wid).length()!=2)throw new AssertionError();
                api("PATCH","drugs/"+wid,obj("{weekdays:[1]}"));if(doses(wid).length()!=0)throw new AssertionError("stale pending doses");
            });
            test("completed dose survives weekday edit; undo uses actual timed receipt",()->{
                day("2026-10-19");JSONArray a=doses(wid);String e=a.getJSONObject(0).getString("eventId");event(e,"taken");eq(drug(wid).getDouble("inventory"),17);
                api("PATCH","drugs/"+wid,obj("{weekdays:[3],timeQuantities:{'08:00':3}}"));if(doses(wid).length()!=1)throw new AssertionError("completed record removed");
                event(e,"scheduled");eq(drug(wid).getDouble("inventory"),17.5);if(doses(wid).length()!=0)throw new AssertionError("undone excluded day should not be rescheduled");
            });
            test("midnight crossover creates selected day's 00:00 plan",()->{
                JSONObject d0=(JSONObject)api("POST","drugs",obj("{name:'midnight',weekdays:[2],times:['00:00'],inventory:4}"));String mid=d0.getString("id");
                if(doses(mid).length()!=0)throw new AssertionError();now.set(java.time.Instant.parse("2026-10-19T16:00:00Z").toEpochMilli());
                if(doses(mid).length()!=1||!"00:00".equals(doses(mid).getJSONObject(0).getString("planned")))throw new AssertionError();
            });
            test("empty, duplicate and out-of-range weekdays are rejected",()->{
                for(String v:new String[]{"[]","[1,1]","[8]","['1']","[1.2]"})response("PATCH","drugs/"+wid,obj("{weekdays:"+v+"}"),400);
            });
            test("bad category, URL barcode and invalid timed quantity are rejected",()->{
                response("PATCH","drugs/"+wid,obj("{category:12}"),400);response("PATCH","drugs/"+wid,obj("{barcode:'https://example.invalid/'}"),400);
                response("PATCH","drugs/"+wid,obj("{timeQuantities:{'08:00':0}}"),400);response("PATCH","drugs/"+wid,obj("{timeQuantities:{'25:00':2}}"),400);
            });
            test("backup restore keeps new fields and revision history",()->{
                JSONObject backup=(JSONObject)api("GET","export",new JSONObject());api("PATCH","drugs/"+wid,obj("{category:'changed',weekdays:[7]}"));api("POST","restore",backup);
                if(!"常用药".equals(drug(wid).getString("category"))||!"[3]".equals(drug(wid).getJSONArray("weekdays").toString()))throw new AssertionError();
                if(drug(wid).getJSONArray("scheduleRevisions").length()<2)throw new AssertionError();
            });
            test("malformed new fields in restore fail without replacing data",()->{
                JSONObject backup=(JSONObject)api("GET","export",new JSONObject());backup.getJSONArray("drugs").getJSONObject(0).put("weekdays",new JSONArray("[0]"));response("POST","restore",backup,400);
                if(!"常用药".equals(drug(wid).getString("category")))throw new AssertionError();
            });
            test("legacy backup without extra fields defaults to daily and one unit",()->{
                JSONObject backup=(JSONObject)api("GET","export",new JSONObject());JSONArray rows=backup.getJSONArray("drugs");
                for(int i=0;i<rows.length();i++){JSONObject d1=rows.getJSONObject(i);for(String key:new String[]{"weekdays","category","barcode","timeQuantities","scheduleRevisions","doseQuantity","inventoryUnit"})d1.remove(key);}
                api("POST","restore",backup);if(doses(wid).length()!=2)throw new AssertionError("legacy plan no longer daily");
            });
            test("non-daily hardware plans rejected before original Bluetooth writer",()->{
                Class<?> p=Class.forName("com.anyao.repair.HardwarePolicy",true,loader);Method valid=p.getMethod("plans",JSONArray.class);
                valid.invoke(null,new JSONArray("[{compartment:1,weekdays:[1,2,3,4,5,6,7]}]"));
                try{valid.invoke(null,new JSONArray("[{compartment:1,weekdays:[1]}]"));throw new AssertionError("silently converted to daily");}catch(InvocationTargetException e){if(!(e.getCause() instanceof IllegalArgumentException))throw e;}
            });
        } catch (Throwable e) {
            results.put(new JSONObject().put("name", "harness completed").put("status", "FAIL").put("detail", e.toString()));
            throw e;
        } finally {
            System.out.println(new JSONObject().put("scope","Real APK classes under Android ART; isolated Store fixture, not installed app/UI/hardware acceptance").put("results",results));
        }
    }
}
