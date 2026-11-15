!macro customInstall
  # Immediately launch our custom dark-neon GUI Setup Wizard!
  Exec '"$INSTDIR\dexxyqisland.exe" --setup'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "dexxyqisland"
!macroend
