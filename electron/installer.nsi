; ---------------------------------------------------------------
; Sawaari - Windows installer (NSIS)
; Packages the unpacked Electron build into a Setup.exe with
; desktop + start-menu shortcuts and an uninstaller.
; No admin rights required (per-user install).
; ---------------------------------------------------------------
!define APPNAME     "Sawaari"
!define APPVERSION  "1.0.0"
!define APPEXE      "Sawaari.exe"
!define PUBLISHER   "Sawaari"
!define SRC         "dist\win-unpacked"
!define OUT         "..\dist-windows\LocalAutoBooking-Setup.exe"

Name "${APPNAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Sawaari"
InstallDirRegKey HKCU "Software\Sawaari" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${APPVERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "Sawaari - auto-rickshaw booking"
VIAddVersionKey "FileVersion" "${APPVERSION}.0"
VIAddVersionKey "ProductVersion" "${APPVERSION}.0"
VIAddVersionKey "LegalCopyright" "Copyright ${PUBLISHER}"

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "build\icon.ico"
!define MUI_UNICON "build\icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APPNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Sawaari" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteRegStr HKCU "Software\Sawaari" "InstallLocation" "$INSTDIR"

  ; shortcuts
  CreateDirectory "$SMPROGRAMS\Sawaari"
  CreateShortcut "$SMPROGRAMS\Sawaari\Sawaari.lnk" "$INSTDIR\${APPEXE}"
  CreateShortcut "$SMPROGRAMS\Sawaari\Uninstall Sawaari.lnk" "$INSTDIR\Uninstall Sawaari.exe"
  CreateShortcut "$DESKTOP\Sawaari.lnk" "$INSTDIR\${APPEXE}"

  ; uninstaller
  WriteUninstaller "$INSTDIR\Uninstall Sawaari.exe"

  ; remember where the app lives so it can find its bundled web app
  WriteRegStr HKCU "Software\Sawaari" "WebDir" "$INSTDIR\resources\web"

  DetailPrint "Sawaari is ready. Launch it from your desktop shortcut."

  MessageBox MB_ICONINFORMATION|MB_OK "Sawaari talks to your server at http://localhost:4000 by default. Keep the API running to book rides, or point the app elsewhere from Server settings on the home screen."
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Sawaari.lnk"
  RMDir /r "$SMPROGRAMS\Sawaari"
  Delete "$INSTDIR\Uninstall Sawaari.exe"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Sawaari"
SectionEnd
