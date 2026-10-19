package com.anyao.repair;

import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import java.util.*;

/** Pure offline luminance decoding, also exercised with generated barcode fixtures. */
public final class BarcodeDecoder {
    private BarcodeDecoder() {}
    public static Result decode(byte[] pixels,int width,int height) {
        if(width<=0||height<=0||pixels.length<width*height)return null;
        Map<DecodeHintType,Object> hints=new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS,Arrays.asList(BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.UPC_E,BarcodeFormat.CODE_128,BarcodeFormat.CODE_39,BarcodeFormat.ITF,BarcodeFormat.QR_CODE,BarcodeFormat.DATA_MATRIX));
        hints.put(DecodeHintType.TRY_HARDER,true);hints.put(DecodeHintType.CHARACTER_SET,"UTF-8");
        MultiFormatReader reader=new MultiFormatReader();reader.setHints(hints);
        for(int rotation=0;rotation<2;rotation++){
            LuminanceSource source=new PlanarYUVLuminanceSource(pixels,width,height,0,0,width,height,false);
            for(int inverse=0;inverse<2;inverse++)try{return reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(inverse==0?source:source.invert())));}catch(ReaderException ignored){}finally{reader.reset();}
            byte[] rotated=new byte[width*height];for(int y=0;y<height;y++)for(int x=0;x<width;x++)rotated[x*height+height-y-1]=pixels[y*width+x];
            pixels=rotated;int swap=width;width=height;height=swap;
        }
        return null;
    }
}
