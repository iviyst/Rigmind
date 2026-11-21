; Rigmind installer: asks "What is this PC for?" and saves the answer to %ProgramData%\Rigmind\mode.json.
; - Updates (auto-update runs the installer with --updated) never show the page or change the choice.
; - Reinstalls keep the existing choice.
; - Silent installs can pass it: "Rigmind Setup 1.3.0.exe" /S /MODE=Work   (Gaming, Work or Both; default Both)
;
; electron-builder includes this file early, before the installer UI library (MUI2) is loaded, and also
; compiles the uninstaller from it. So nothing here uses MUI until the page macro is inserted, and
; the page and install step only exist in the installer.
!ifndef BUILD_UNINSTALLER
!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh

Var RmDialog
Var RmGaming
Var RmWork
Var RmBoth
Var RmMode

; Inserted by electron-builder right after the "choose install folder" page, where MUI is loaded.
!macro customPageAfterChangeDir
  Page custom RmModePageCreate RmModePageLeave

  Function RmModePageCreate
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "--updated" $1
    ${IfNot} ${Errors}
      Abort
    ${EndIf}
    ReadEnvStr $0 ProgramData
    ${If} ${FileExists} "$0\Rigmind\mode.json"
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "What is this PC for?" "Rigmind shows the tools that fit. You can change this any time in Settings."
    nsDialogs::Create 1018
    Pop $RmDialog
    ${If} $RmDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateRadioButton} 0 6u 100% 12u "&Gaming"
    Pop $RmGaming
    ${NSD_CreateLabel} 14u 19u 92% 18u "Game Boost, Game Coach, overnight game updates and shader warm-up, fans and RGB."
    Pop $1

    ${NSD_CreateRadioButton} 0 44u 100% 12u "&Work"
    Pop $RmWork
    ${NSD_CreateLabel} 14u 57u 92% 18u "App Boost for heavy apps, Meeting Mode for calls, overnight app updates, printers and backup checks."
    Pop $1

    ${NSD_CreateRadioButton} 0 82u 100% 12u "&Both (recommended)"
    Pop $RmBoth
    ${NSD_CreateLabel} 14u 95u 92% 18u "Everything. Rigmind switches on its own: a game turns on gaming tools, a call turns on Meeting Mode."
    Pop $1

    ${NSD_Check} $RmBoth
    nsDialogs::Show
  FunctionEnd

  Function RmModePageLeave
    ${NSD_GetState} $RmGaming $1
    ${NSD_GetState} $RmWork $2
    ${If} $1 == ${BST_CHECKED}
      StrCpy $RmMode "gaming"
    ${ElseIf} $2 == ${BST_CHECKED}
      StrCpy $RmMode "work"
    ${Else}
      StrCpy $RmMode "both"
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  ReadEnvStr $5 ProgramData
  ; A /MODE= switch wins (silent and IT installs).
  ${GetParameters} $3
  ClearErrors
  ${GetOptions} $3 "/MODE=" $4
  ${IfNot} ${Errors}
    ${If} $4 == "gaming"
      StrCpy $RmMode "gaming"
    ${ElseIf} $4 == "work"
      StrCpy $RmMode "work"
    ${ElseIf} $4 == "both"
      StrCpy $RmMode "both"
    ${EndIf}
  ${EndIf}
  ; Nothing chosen (silent install or update): keep an existing choice, otherwise default to Both.
  ${If} $RmMode == ""
    ${IfNot} ${FileExists} "$5\Rigmind\mode.json"
      StrCpy $RmMode "both"
    ${EndIf}
  ${EndIf}
  ${If} $RmMode != ""
    CreateDirectory "$5\Rigmind"
    FileOpen $6 "$5\Rigmind\mode.json" w
    FileWrite $6 '{"mode":"$RmMode"}'
    FileClose $6
  ${EndIf}
!macroend
!endif
