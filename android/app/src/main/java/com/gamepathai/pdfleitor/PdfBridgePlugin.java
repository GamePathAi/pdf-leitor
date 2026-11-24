package com.gamepathai.pdfleitor;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Ponte entre o Android e o app web:
 *  - recebe PDFs abertos por "Abrir com" / "Compartilhar" e avisa o app (evento "fileOpened");
 *  - salva o PDF editado onde o usuário escolher (saveFile).
 */
@CapacitorPlugin(name = "PdfBridge")
public class PdfBridgePlugin extends Plugin {

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        final Uri uri = pdfUri(intent);
        if (uri == null) return;
        final ContentResolver resolver = getContext().getContentResolver();
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "abertos");
                if (!dir.exists()) dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File out = new File(dir, System.currentTimeMillis() + ".pdf");
                try (InputStream in = resolver.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                    if (in == null) throw new Exception("sem acesso ao arquivo");
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                JSObject data = new JSObject();
                data.put("path", out.getAbsolutePath());
                data.put("name", displayName(resolver, uri));
                // retainUntilConsumed: se o app web ainda não carregou, o evento espera por ele.
                notifyListeners("fileOpened", data, true);
            } catch (Exception e) {
                JSObject data = new JSObject();
                data.put("error", String.valueOf(e.getMessage()));
                notifyListeners("fileOpened", data, true);
            }
        }).start();
    }

    @SuppressWarnings("deprecation")
    private Uri pdfUri(Intent intent) {
        if (intent == null) return null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) return intent.getData();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            return intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        return null;
    }

    private String displayName(ContentResolver resolver, Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) {
            }
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "documento.pdf";
        return name;
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "documento.pdf");
        if (call.getString("data") == null) {
            call.reject("sem dados");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelado", "CANCELED");
            return;
        }
        Uri uri = result.getData().getData();
        String data = call.getString("data");
        new Thread(() -> {
            try (OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (os == null) throw new Exception("sem acesso ao destino");
                os.write(Base64.decode(data, Base64.DEFAULT));
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }
}
