package com.anyao.repair;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.hardware.camera2.*;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.*;
import android.util.Size;
import android.view.*;
import android.widget.*;
import com.google.zxing.Result;
import org.json.JSONObject;
import java.nio.ByteBuffer;
import java.util.*;

/** Local camera scanner. No network lookup, uploads, intents from scanned text or background camera. */
public final class BarcodeActivity extends Activity implements TextureView.SurfaceTextureListener {
    private TextureView preview;private TextView hint;private HandlerThread worker;private Handler handler;
    private CameraDevice camera;private CameraCaptureSession session;private ImageReader reader;private Surface displaySurface;
    private final Handler main=new Handler(Looper.getMainLooper());private final Runnable timeout=()->complete("error","","","扫码已超时，请重试或手动填写条码");
    private String token;private volatile boolean finished=false,resumed=false;private boolean torch=false,imageOnly=false;private CaptureRequest.Builder request;
    static final String PREFS="anyao_barcode";
    static void result(Context c,String token,String state,String text,String format,String error){
        try{JSONObject r=new JSONObject().put("token",token).put("state",state).put("text",text).put("format",format).put("error",error);
            c.getSharedPreferences(PREFS,0).edit().putString("result",r.toString()).apply();}catch(Exception ignored){}
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);token=getIntent().getStringExtra("token");imageOnly=getIntent().getBooleanExtra("imageOnly",false);if(token==null||!token.matches("[a-f0-9-]{36}")){finish();return;}
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(24,24,24,24);root.setBackgroundColor(Color.rgb(15,20,25));
        hint=new TextView(this);hint.setTextColor(Color.WHITE);hint.setTextSize(20);hint.setText("扫描药品包装条码\n对准条形码或二维码，保持光线充足\n内容只在本机识别，不会打开网址");root.addView(hint);
        preview=new TextureView(this);preview.setSurfaceTextureListener(this);root.addView(preview,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout buttons=new LinearLayout(this);Button cancel=new Button(this);cancel.setText("取消");cancel.setOnClickListener(v->complete("cancelled","","",""));buttons.addView(cancel);
        Button light=new Button(this);light.setText("补光");light.setOnClickListener(v->{torch=!torch;try{if(request!=null&&session!=null){request.set(CaptureRequest.FLASH_MODE,torch?CaptureRequest.FLASH_MODE_TORCH:CaptureRequest.FLASH_MODE_OFF);session.setRepeatingRequest(request.build(),null,handler);}}catch(Exception e){hint.setText("这台手机暂时无法补光，请增加环境光");}});buttons.addView(light);
        Button image=new Button(this);image.setText("从图片识别");image.setOnClickListener(v->pickImage());buttons.addView(image);root.addView(buttons);setContentView(root);
        main.postDelayed(timeout,175000);
        if(imageOnly)main.post(this::pickImage);
        else if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.CAMERA},32);
    }
    @Override protected void onResume(){super.onResume();resumed=true;worker=new HandlerThread("anyao-barcode");worker.start();handler=new Handler(worker.getLooper());if(preview.isAvailable())openCamera();}
    @Override protected void onPause(){resumed=false;closeCamera();if(worker!=null){worker.quitSafely();worker=null;}super.onPause();}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){super.onRequestPermissionsResult(code,permissions,results);if(code==32){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED){if(preview.isAvailable())openCamera();}else complete("error","","","相机权限未允许，可手动填写条码");}}
    private synchronized void openCamera(){
        if(imageOnly||!resumed||finished||camera!=null||reader!=null||checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)return;
        try{
            CameraManager manager=(CameraManager)getSystemService(CAMERA_SERVICE);String id=null;CameraCharacteristics chars=null;
            for(String candidate:manager.getCameraIdList()){CameraCharacteristics c=manager.getCameraCharacteristics(candidate);Integer facing=c.get(CameraCharacteristics.LENS_FACING);if(facing!=null&&facing==CameraCharacteristics.LENS_FACING_BACK){id=candidate;chars=c;break;}}
            if(id==null)throw new IllegalStateException("没有背面相机");
            StreamConfigurationMap map=chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);Size size=null;
            for(Size s:map.getOutputSizes(ImageFormat.YUV_420_888))if(s.getWidth()<=1280&&s.getHeight()<=960&&(size==null||Math.abs(s.getWidth()*s.getHeight()-640*480)<Math.abs(size.getWidth()*size.getHeight()-640*480)))size=s;
            if(size==null)throw new IllegalStateException("没有可用的相机图像格式");
            preview.getSurfaceTexture().setDefaultBufferSize(size.getWidth(),size.getHeight());
            Integer orientation=chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
            if(orientation!=null&&(orientation==90||orientation==270)){
                float w=preview.getWidth(),h=preview.getHeight();Matrix transform=new Matrix();transform.postRotate(orientation,w/2,h/2);transform.postScale(w/h,(float)size.getWidth()/size.getHeight(),w/2,h/2);preview.setTransform(transform);
            }
            reader=ImageReader.newInstance(size.getWidth(),size.getHeight(),ImageFormat.YUV_420_888,2);
            reader.setOnImageAvailableListener(r->{Image frame=null;try{
                frame=r.acquireLatestImage();if(frame==null||finished)return;int w=frame.getWidth(),h=frame.getHeight();Image.Plane p=frame.getPlanes()[0];ByteBuffer data=p.getBuffer();byte[] pixels=new byte[w*h];int stride=p.getRowStride(),pixel=p.getPixelStride(),start=data.position();
                for(int y=0;y<h;y++)for(int x=0;x<w;x++)pixels[y*w+x]=data.get(start+y*stride+x*pixel);
                Result decoded=BarcodeDecoder.decode(pixels,w,h);if(decoded!=null)complete("done",decoded.getText(),decoded.getBarcodeFormat().name(),"");
            }catch(Exception ignored){}finally{if(frame!=null)frame.close();}},handler);
            manager.openCamera(id,new CameraDevice.StateCallback(){
                public void onOpened(CameraDevice c){synchronized(BarcodeActivity.this){if(!resumed||finished){c.close();return;}camera=c;}
                    try{Surface display=new Surface(preview.getSurfaceTexture()),scan=reader.getSurface();displaySurface=display;c.createCaptureSession(Arrays.asList(display,scan),new CameraCaptureSession.StateCallback(){
                        public void onConfigured(CameraCaptureSession s){if(!resumed||finished){s.close();return;}session=s;try{request=c.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);request.addTarget(display);request.addTarget(scan);request.set(CaptureRequest.CONTROL_AF_MODE,CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);s.setRepeatingRequest(request.build(),null,handler);}catch(Exception e){fail(e);}}
                        public void onConfigureFailed(CameraCaptureSession s){fail(new IllegalStateException("相机预览启动失败"));}},handler);
                    }catch(Exception e){fail(e);}}
                public void onDisconnected(CameraDevice c){c.close();if(resumed)complete("error","","","相机已断开，请重试");}
                public void onError(CameraDevice c,int error){c.close();if(resumed)complete("error","","","相机忙碌，请关闭其他使用相机的应用后重试");}
            },handler);
        }catch(Exception e){fail(e);}
    }
    private void fail(Exception e){complete("error","","","无法启动扫码："+e.getClass().getSimpleName());}
    private synchronized void closeCamera(){if(session!=null){session.close();session=null;}if(camera!=null){camera.close();camera=null;}if(reader!=null){reader.close();reader=null;}if(displaySurface!=null){displaySurface.release();displaySurface=null;}request=null;torch=false;}
    private synchronized void complete(String state,String text,String format,String error){if(finished)return;finished=true;result(this,token,state,text.length()>512?text.substring(0,512):text,format,error);runOnUiThread(this::finish);}
    @Override public void onBackPressed(){complete("cancelled","","","");}
    @Override protected void onDestroy(){main.removeCallbacks(timeout);if(!finished)result(this,token,"cancelled","","","");closeCamera();super.onDestroy();}
    private void pickImage(){Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);try{startActivityForResult(pick,31);}catch(Exception e){if(imageOnly)complete("error","","","无法打开图片选择器");else hint.setText("无法打开图片选择器，请使用相机扫描");}}
    @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(req!=31)return;if(result!=RESULT_OK||data==null){if(imageOnly)complete("cancelled","","","");return;}
        new Thread(()->{try{
            BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
            try(java.io.InputStream in=getContentResolver().openInputStream(data.getData())){BitmapFactory.decodeStream(in,null,options);}
            options.inSampleSize=1;while(options.outWidth/options.inSampleSize>1600||options.outHeight/options.inSampleSize>1600)options.inSampleSize*=2;options.inJustDecodeBounds=false;
            Bitmap b;try(java.io.InputStream in=getContentResolver().openInputStream(data.getData())){b=BitmapFactory.decodeStream(in,null,options);}if(b==null)throw new IllegalArgumentException();
            int w=b.getWidth(),h=b.getHeight();int[] colors=new int[w*h];byte[] pixels=new byte[w*h];b.getPixels(colors,0,w,0,0,w,h);b.recycle();for(int i=0;i<colors.length;i++)pixels[i]=(byte)((Color.red(colors[i])*299+Color.green(colors[i])*587+Color.blue(colors[i])*114)/1000);
            Result r=BarcodeDecoder.decode(pixels,w,h);if(r!=null)complete("done",r.getText(),r.getBarcodeFormat().name(),"");else if(imageOnly)complete("error","","","图片中没有识别到条码，请换清晰图片");else runOnUiThread(()->hint.setText("图片中没有识别到条码，请换清晰图片或使用相机"));
        }catch(Exception e){if(imageOnly)complete("error","","","无法读取这张图片，请重新选择");else runOnUiThread(()->hint.setText("无法读取这张图片，请重新选择"));}},"anyao-image-code").start();
    }
    public void onSurfaceTextureAvailable(SurfaceTexture s,int w,int h){openCamera();}
    public void onSurfaceTextureSizeChanged(SurfaceTexture s,int w,int h){}
    public boolean onSurfaceTextureDestroyed(SurfaceTexture s){closeCamera();return true;}
    public void onSurfaceTextureUpdated(SurfaceTexture s){}
}
