/* Grandpa AI app for Windows (Phase A3). The server appends each app's address, name and icon to a copy
 * of this program (see server/windows-app.js); nothing else changes. When opened it offers to add the app
 * to the Start menu and the desktop, as shortcuts that open it in its own Microsoft Edge (or Chrome)
 * window, then opens it. It copies nothing, changes no settings and needs no administrator rights. To
 * remove the app, delete its shortcuts. */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define COBJMACROS
#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <objbase.h>
#include <wchar.h>

#define MAX_TEXT 2048

static wchar_t url[MAX_TEXT], name[256], slug[64], browser[MAX_PATH], args[MAX_TEXT + 16];
static unsigned char *icon = NULL;
static DWORD iconSize = 0;

static void widen(const char *text, int length, wchar_t *out, int room) {
  int n = MultiByteToWideChar(CP_UTF8, 0, text, length, out, room - 1);
  out[n < 0 ? 0 : n] = 0;
}

/* The app's details: "url=…\nname=…\nslug=…\n", the icon, then a 16-byte footer: GPAPP001, text size, icon size. */
static BOOL readDetails(void) {
  wchar_t self[MAX_PATH];
  if (!GetModuleFileNameW(NULL, self, MAX_PATH)) return FALSE;
  HANDLE file = CreateFileW(self, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
  if (file == INVALID_HANDLE_VALUE) return FALSE;
  LARGE_INTEGER size;
  unsigned char footer[16];
  DWORD got = 0;
  BOOL ok = GetFileSizeEx(file, &size) && size.QuadPart > 16;
  LARGE_INTEGER at; at.QuadPart = size.QuadPart - 16;
  ok = ok && SetFilePointerEx(file, at, NULL, FILE_BEGIN) && ReadFile(file, footer, 16, &got, NULL) && got == 16 && memcmp(footer, "GPAPP001", 8) == 0;
  DWORD textSize = ok ? *(DWORD *)(footer + 8) : 0;
  iconSize = ok ? *(DWORD *)(footer + 12) : 0;
  ok = ok && textSize > 0 && textSize < 8192 && iconSize < 4 * 1024 * 1024 && (LONGLONG)textSize + iconSize + 16 < size.QuadPart;
  char *text = ok ? (char *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, textSize + 1) : NULL;
  icon = ok && iconSize ? (unsigned char *)HeapAlloc(GetProcessHeap(), 0, iconSize) : NULL;
  at.QuadPart = size.QuadPart - 16 - iconSize - textSize;
  ok = ok && text && (!iconSize || icon) && SetFilePointerEx(file, at, NULL, FILE_BEGIN) && ReadFile(file, text, textSize, &got, NULL) && got == textSize
    && (!iconSize || (ReadFile(file, icon, iconSize, &got, NULL) && got == iconSize));
  CloseHandle(file);
  if (!ok) return FALSE;
  for (char *line = text; line && *line; ) {
    char *end = strchr(line, '\n');
    int length = end ? (int)(end - line) : (int)strlen(line);
    if (!strncmp(line, "url=", 4)) widen(line + 4, length - 4, url, MAX_TEXT);
    else if (!strncmp(line, "name=", 5)) widen(line + 5, length - 5, name, 256);
    else if (!strncmp(line, "slug=", 5)) widen(line + 5, length - 5, slug, 64);
    line = end ? end + 1 : NULL;
  }
  /* Only an https address of plain characters is opened (it becomes a command-line argument). */
  if (wcsncmp(url, L"https://", 8) || !slug[0] || !name[0]) return FALSE;
  for (wchar_t *c = url; *c; c++) if (*c <= L' ' || *c == L'"' || *c == L'^' || *c == L'%' || *c > 126) return FALSE;
  for (wchar_t *c = slug; *c; c++) if (!((*c >= L'a' && *c <= L'z') || (*c >= L'0' && *c <= L'9') || *c == L'-')) return FALSE;
  for (wchar_t *c = name; *c; c++) if (wcschr(L"\\/:*?\"<>|", *c) || *c < L' ') *c = L' ';
  return TRUE;
}

static BOOL appPath(HKEY root, const wchar_t *exe, wchar_t *out) {
  wchar_t key[256];
  DWORD size = MAX_PATH * sizeof(wchar_t);
  wsprintfW(key, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\%s", exe);
  return RegGetValueW(root, key, NULL, RRF_RT_REG_SZ, NULL, out, &size) == ERROR_SUCCESS && GetFileAttributesW(out) != INVALID_FILE_ATTRIBUTES;
}

/* Edge first (part of Windows 10 and 11), then Chrome; without either, the default browser opens the address. */
static void findBrowser(void) {
  browser[0] = 0;
  if (!appPath(HKEY_LOCAL_MACHINE, L"msedge.exe", browser) && !appPath(HKEY_CURRENT_USER, L"msedge.exe", browser)
      && !appPath(HKEY_LOCAL_MACHINE, L"chrome.exe", browser) && !appPath(HKEY_CURRENT_USER, L"chrome.exe", browser)) browser[0] = 0;
  wsprintfW(args, L"--app=\"%s\"", url);
}

static void open(void) {
  if (!browser[0] || (INT_PTR)ShellExecuteW(NULL, L"open", browser, args, NULL, SW_SHOWNORMAL) <= 32)
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

static BOOL shortcut(int folder, const wchar_t *iconFile, wchar_t *made) {
  wchar_t dir[MAX_PATH];
  if (FAILED(SHGetFolderPathW(NULL, folder, NULL, SHGFP_TYPE_CURRENT, dir))) return FALSE;
  wsprintfW(made, L"%s\\%s.lnk", dir, name);
  IShellLinkW *link = NULL;
  IPersistFile *file = NULL;
  if (FAILED(CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void **)&link))) return FALSE;
  if (browser[0]) { IShellLinkW_SetPath(link, browser); IShellLinkW_SetArguments(link, args); }
  else IShellLinkW_SetPath(link, url);
  IShellLinkW_SetDescription(link, name);
  if (iconFile[0]) IShellLinkW_SetIconLocation(link, iconFile, 0);
  BOOL ok = SUCCEEDED(IShellLinkW_QueryInterface(link, &IID_IPersistFile, (void **)&file)) && SUCCEEDED(IPersistFile_Save(file, made, TRUE));
  if (file) IPersistFile_Release(file);
  IShellLinkW_Release(link);
  return ok;
}

/* The icon goes to %LOCALAPPDATA%\Grandpa AI apps\<address>\app.ico; the shortcuts use it. */
static BOOL install(void) {
  wchar_t base[MAX_PATH], dir[MAX_PATH], iconFile[MAX_PATH] = L"", made[MAX_PATH];
  if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, SHGFP_TYPE_CURRENT, base)) && iconSize) {
    wsprintfW(dir, L"%s\\Grandpa AI apps\\%s", base, slug);
    SHCreateDirectoryExW(NULL, dir, NULL);
    wsprintfW(iconFile, L"%s\\app.ico", dir);
    HANDLE file = CreateFileW(iconFile, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    DWORD wrote = 0;
    if (file == INVALID_HANDLE_VALUE || !WriteFile(file, icon, iconSize, &wrote, NULL) || wrote != iconSize) iconFile[0] = 0;
    if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
  }
  BOOL menu = shortcut(CSIDL_PROGRAMS, iconFile, made);
  BOOL desk = shortcut(CSIDL_DESKTOPDIRECTORY, iconFile, made);
  return menu || desk;
}

static BOOL installed(void) {
  wchar_t dir[MAX_PATH], path[MAX_PATH];
  if (FAILED(SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, SHGFP_TYPE_CURRENT, dir))) return FALSE;
  wsprintfW(path, L"%s\\%s.lnk", dir, name);
  return GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES;
}

/* For checking a copy without opening windows: --details <file> writes what was read; --install-quiet installs. */
static void writeDetails(const wchar_t *path) {
  wchar_t text[MAX_TEXT * 2];
  char out[MAX_TEXT * 4];
  wsprintfW(text, L"url=%s\nname=%s\nslug=%s\nbrowser=%s\nicon=%lu\n", url, name, slug, browser, (unsigned long)iconSize);
  int n = WideCharToMultiByte(CP_UTF8, 0, text, -1, out, sizeof out, NULL, NULL);
  HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  DWORD wrote;
  if (file != INVALID_HANDLE_VALUE) { WriteFile(file, out, n > 0 ? n - 1 : 0, &wrote, NULL); CloseHandle(file); }
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR line, int show) {
  (void)instance; (void)previous; (void)show;
  int count = 0;
  wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &count);
  if (!readDetails()) {
    MessageBoxW(NULL, L"This app file is damaged or incomplete. Download it again from the app's Get the app page.", L"Grandpa AI app", MB_OK | MB_ICONERROR);
    return 1;
  }
  findBrowser();
  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  if (count >= 3 && !wcscmp(argv[1], L"--details")) { writeDetails(argv[2]); return 0; }
  if (count >= 2 && !wcscmp(argv[1], L"--install-quiet")) return install() ? 0 : 2;
  if (!installed()) {
    wchar_t question[512];
    wsprintfW(question, L"Install %s on this computer?\n\nIt will be added to the Start menu and the desktop, and opens in its own window. To remove it later, delete its shortcuts.", name);
    if (MessageBoxW(NULL, question, name, MB_YESNO | MB_ICONQUESTION) == IDYES) {
      if (install()) {
        wchar_t done[512];
        wsprintfW(done, L"%s is installed. Open it any time from the Start menu or the desktop.", name);
        MessageBoxW(NULL, done, name, MB_OK | MB_ICONINFORMATION);
      } else MessageBoxW(NULL, L"The shortcuts could not be made. The app will open now; you can keep this file to open it again.", name, MB_OK | MB_ICONWARNING);
    }
  }
  open();
  (void)line;
  return 0;
}
