package com.grandpaai.shell;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.json.JSONObject;

/**
 * A published Grandpa AI app, full screen. It opens the app's own address (assets/app.json), so
 * every update the owner publishes reaches the phone without a new download, and the app's offline
 * helper keeps it working without internet. Links to other websites open in the phone's browser.
 * No code from the app's author runs here outside the web page; the page gets no access to the phone.
 */
public class MainActivity extends Activity {
  private static final int PICK_FILES = 7;
  private WebView web;
  private FrameLayout root;
  private View fullScreen;
  private WebChromeClient.CustomViewCallback fullScreenDone;
  private ValueCallback<Uri[]> picking;
  private String start = "https://sites.libgrandpaai.com/";
  private String host = "sites.libgrandpaai.com";
  private String path = "/";
  private String slug = "";
  private String name = "This app";

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    readConfig();
    root = new FrameLayout(this);
    web = new WebView(this);
    root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    setContentView(root);

    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMediaPlaybackRequiresUserGesture(true);
    settings.setUserAgentString(settings.getUserAgentString() + " GrandpaApp/1");

    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (inside(url)) return false;
        openOutside(url);
        return true;
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) view.loadDataWithBaseURL(start, offlinePage(), "text/html", "utf-8", null);
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (picking != null) picking.onReceiveValue(null);
        picking = callback;
        try {
          startActivityForResult(params.createIntent(), PICK_FILES);
          return true;
        } catch (Exception e) {
          picking = null;
          return false;
        }
      }

      @Override
      public void onShowCustomView(View view, CustomViewCallback done) {
        if (fullScreen != null) { done.onCustomViewHidden(); return; }
        fullScreen = view;
        fullScreenDone = done;
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setVisibility(View.GONE);
      }

      @Override
      public void onHideCustomView() {
        leaveFullScreen();
      }
    });

    if (saved != null) web.restoreState(saved);
    else web.loadUrl(start);
  }

  private void readConfig() {
    try {
      InputStream in = getAssets().open("app.json");
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buffer = new byte[4096];
      for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
      in.close();
      JSONObject config = new JSONObject(out.toString("UTF-8"));
      Uri url = Uri.parse(config.getString("url"));
      if ("https".equals(url.getScheme()) && url.getHost() != null) {
        start = url.toString();
        host = url.getHost();
        path = url.getPath() == null || url.getPath().isEmpty() ? "/" : url.getPath();
      }
      slug = config.optString("slug", "");
      name = config.optString("name", name);
      String colour = config.optString("colour", "");
      if (colour.matches("#[0-9a-fA-F]{6}")) getWindow().setStatusBarColor(Color.parseColor(colour));
    } catch (Exception e) {
      // The template's own address is used.
    }
  }

  /** Pages of this app stay in the app; everything else opens in the browser. */
  private boolean inside(Uri url) {
    if (!"https".equals(url.getScheme()) || !host.equals(url.getHost())) return false;
    String p = url.getPath() == null ? "/" : url.getPath();
    return p.startsWith(path) || (!slug.isEmpty() && p.startsWith("/s/" + slug + "/"));
  }

  private void openOutside(Uri url) {
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, url));
    } catch (Exception e) {
      // No app can open this link.
    }
  }

  private String offlinePage() {
    String safe = name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        + "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:sans-serif;text-align:center;padding:24px;background:#f1f5f9;color:#0f172a}"
        + "a{display:inline-block;margin-top:16px;padding:14px 24px;border-radius:12px;background:#0f172a;color:#fff;text-decoration:none;font-weight:bold}</style></head>"
        + "<body><main><h1>" + safe + " needs the internet the first time</h1><p>Connect to the internet and try again. After that, it keeps working offline.</p>"
        + "<a href=\"" + start + "\">Try again</a></main></body></html>";
  }

  private void leaveFullScreen() {
    if (fullScreen == null) return;
    root.removeView(fullScreen);
    fullScreen = null;
    web.setVisibility(View.VISIBLE);
    if (fullScreenDone != null) fullScreenDone.onCustomViewHidden();
    fullScreenDone = null;
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request != PICK_FILES || picking == null) return;
    picking.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
    picking = null;
  }

  @Override
  public void onBackPressed() {
    if (fullScreen != null) leaveFullScreen();
    else if (web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }

  @Override
  protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state);
    web.saveState(state);
  }
}
