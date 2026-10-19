import com.anyao.repair.BarcodeDecoder;
import com.google.zxing.*;
import com.google.zxing.common.BitMatrix;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;
import java.util.*;

public final class BarcodeHarness {
    static int count=0;
    static byte[] pixels(BitMatrix m){byte[] p=new byte[m.getWidth()*m.getHeight()];for(int y=0;y<m.getHeight();y++)for(int x=0;x<m.getWidth();x++)p[y*m.getWidth()+x]=(byte)(m.get(x,y)?0:255);return p;}
    static void check(String name,byte[] p,int w,int h,String text){Result r=BarcodeDecoder.decode(p,w,h);if(text==null?r!=null:r==null||!text.equals(r.getText()))throw new AssertionError(name+": "+r);count++;System.out.println("PASS "+name);}
    public static void main(String[] args) throws Exception {
        MultiFormatWriter writer=new MultiFormatWriter();Map<EncodeHintType,Object> hints=new EnumMap<>(EncodeHintType.class);hints.put(EncodeHintType.MARGIN,20);
        String[] values={"6901234567892","96385074","12345678901234567890","6901234567892","12345678901234567890"};
        BarcodeFormat[] formats={BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.CODE_128,BarcodeFormat.QR_CODE,BarcodeFormat.DATA_MATRIX};
        for(int i=0;i<formats.length;i++){
            BitMatrix m=writer.encode(values[i],formats[i],formats[i]==BarcodeFormat.EAN_13?800:400,formats[i]==BarcodeFormat.EAN_13?240:400,hints);byte[] p=pixels(m);int w=m.getWidth(),h=m.getHeight();
            check(formats[i].name(),p,w,h,values[i]);
            if(i==0){
                byte[] rotated=new byte[p.length];for(int y=0;y<h;y++)for(int x=0;x<w;x++)rotated[x*h+h-y-1]=p[y*w+x];check("portrait rotated EAN",rotated,h,w,values[i]);
                byte[] inverse=p.clone();for(int n=0;n<p.length;n++)inverse[n]=(byte)(255-(p[n]&255));check("inverted EAN",inverse,w,h,values[i]);
            }
            if(i==0||i==3){BufferedImage image=new BufferedImage(w,h,BufferedImage.TYPE_INT_RGB);for(int y=0;y<h;y++)for(int x=0;x<w;x++)image.setRGB(x,y,m.get(x,y)?0:0xffffff);ImageIO.write(image,"png",new File(args[0],i==0?"barcode-ean13-fixture.png":"barcode-qr-fixture.png"));}
        }
        byte[] blank=new byte[640*480];Arrays.fill(blank,(byte)255);check("blank is not a barcode",blank,640,480,null);check("invalid dimensions",new byte[1],640,480,null);
        System.out.println("PASS TOTAL "+count);
    }
}
