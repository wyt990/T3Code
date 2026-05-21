; Force-close T3 Code before install/update.
; Desktop runs a Node-mode backend via the same t3code.exe image; NSIS graceful close often leaves it running.

!macro customCloseApp
  nsExec::ExecToLog 'taskkill /F /T /IM t3code.exe'
  Pop $0
  Sleep 1000
!macroend

!macro customInit
  !insertmacro customCloseApp
!macroend
