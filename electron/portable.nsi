; ---------------------------------------------------------------
; Sawaari - Windows portable build (NSIS)
; Extracts the app to a temporary folder and runs it, leaving no
; installation behind. Useful for running from a USB stick or a
; locked-down machine.
; ---------------------------------------------------------------
!define APPNAME     "Sawaari"
!define APPVERSION  "1.0.0"
!define APPEXE      "Sawaari.exe"
!define SRC         "dist\win-unpacked"
!define OUT         "..\dist-windows\LocalAutoBooking-Portable.exe"

Name "${APPNAME} (portable)"
OutFile "${OUT}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${APPVERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME} Portable"
VIAddVersionKey "CompanyName" "Sawaari"
VIAddVersionKey "FileDescription" "Sawaari portable - auto-rickshaw booking"
VIAddVersionKey "FileVersion" "${APPVERSION}.0"
VIAddVersionKey "ProductVersion" "${APPVERSION}.0"

!include "MUI2.nsh"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$TEMP\SawaariPortable\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APPNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

Section "Extract"
  ; clean any previous run
  RMDir /r "$TEMP\SawaariPortable"
  SetOutPath "$TEMP\SawaariPortable"
  File /r "${SRC}\*.*"
  ExecShell "open" "$TEMP\SawaariPortable"
SectionEnd
