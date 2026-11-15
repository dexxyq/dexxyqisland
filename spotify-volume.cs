using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class SpotifyVolume
{
    public static int Set(int percent)
    {
        return VisitSessions(percent, null);
    }

    public static int Get()
    {
        var levels = new System.Collections.Generic.List<int>();
        VisitSessions(0, levels);
        return levels.Count == 0 ? -1 : levels[0];
    }

    private static int VisitSessions(int percent, System.Collections.Generic.List<int> levels)
    {
        var enumerator = (DeviceEnumerator)new AudioEnumerator();
        DeviceCollection devices = null;
        int changed = 0;
        try
        {
            enumerator.EnumAudioEndpoints(0, 1, out devices); // Active render endpoints.
            uint count;
            devices.GetCount(out count);
            for (uint index = 0; index < count; index++)
            {
                AudioDevice device;
                devices.Item(index, out device);
                try { changed += VisitDeviceSessions(device, percent / 100f, levels); }
                catch (COMException) { } // A device can disconnect during enumeration.
                finally { Marshal.ReleaseComObject(device); }
            }
            return changed;
        }
        finally
        {
            if (devices != null) Marshal.ReleaseComObject(devices);
            Marshal.ReleaseComObject(enumerator);
        }
    }

    private static int VisitDeviceSessions(AudioDevice device, float level, System.Collections.Generic.List<int> levels)
    {
        Guid managerId = typeof(SessionManager).GUID;
        object manager;
        device.Activate(ref managerId, 23, IntPtr.Zero, out manager);
        SessionEnumerator sessions = null;
        int changed = 0;
        try
        {
            ((SessionManager)manager).GetSessionEnumerator(out sessions);
            int count;
            sessions.GetCount(out count);
            for (int index = 0; index < count; index++)
            {
                SessionControl session;
                sessions.GetSession(index, out session);
                try
                {
                    uint pid;
                    session.GetProcessId(out pid);
                    try
                    {
                        using (var process = Process.GetProcessById((int)pid))
                            if (!process.ProcessName.Equals("Spotify", StringComparison.OrdinalIgnoreCase)) continue;
                    }
                    catch (ArgumentException) { continue; }

                    var volume = (SessionVolume)session;
                    var context = Guid.Empty;
                    if (levels == null) volume.SetMasterVolume(level, ref context);
                    else
                    {
                        float current;
                        volume.GetMasterVolume(out current);
                        levels.Add((int)Math.Round(current * 100));
                    }
                    changed++;
                }
                finally { Marshal.ReleaseComObject(session); }
            }
            return changed;
        }
        finally
        {
            if (sessions != null) Marshal.ReleaseComObject(sessions);
            Marshal.ReleaseComObject(manager);
        }
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class AudioEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface DeviceEnumerator
    {
        void EnumAudioEndpoints(int dataFlow, int stateMask, out DeviceCollection devices);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface DeviceCollection
    {
        void GetCount(out uint count);
        void Item(uint index, out AudioDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface AudioDevice
    {
        void Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface SessionManager
    {
        void GetAudioSessionControl();
        void GetSimpleAudioVolume();
        void GetSessionEnumerator(out SessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface SessionEnumerator
    {
        void GetCount(out int count);
        void GetSession(int index, out SessionControl session);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface SessionControl
    {
        void GetState();
        void GetDisplayName();
        void SetDisplayName();
        void GetIconPath();
        void SetIconPath();
        void GetGroupingParam();
        void SetGroupingParam();
        void RegisterAudioSessionNotification();
        void UnregisterAudioSessionNotification();
        void GetSessionIdentifier();
        void GetSessionInstanceIdentifier();
        void GetProcessId(out uint pid);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface SessionVolume
    {
        void SetMasterVolume(float level, ref Guid context);
        void GetMasterVolume(out float level);
    }
}
