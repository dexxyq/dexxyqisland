using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class IslandAudio
{
    public class Endpoint
    {
        public string id;
        public string name;
        public int flow;
        public bool isDefault;
        public bool muted;
    }

    static void Check(int hr) { Marshal.ThrowExceptionForHR(hr); }
    static void Release(object instance) { if (instance != null) Marshal.ReleaseComObject(instance); }

    public static Endpoint[] List()
    {
        var result = new List<Endpoint>();
        var enumerator = (Enumerator)new EnumeratorObject();
        try
        {
            for (int flow = 0; flow < 2; flow++)
            {
                string defaultId = DefaultId(enumerator, flow, 0);
                Collection collection = null;
                try
                {
                    Check(enumerator.EnumAudioEndpoints(flow, 1, out collection));
                    uint count;
                    Check(collection.GetCount(out count));
                    for (uint i = 0; i < count; i++)
                    {
                        Device device = null;
                        try
                        {
                            Check(collection.Item(i, out device));
                            string id;
                            Check(device.GetId(out id));
                            result.Add(new Endpoint { id = id, name = Name(device), flow = flow,
                                isDefault = id == defaultId, muted = flow == 1 && Muted(device) });
                        }
                        catch (COMException) { /* A device may disconnect while the list is read. */ }
                        finally { Release(device); }
                    }
                }
                finally { Release(collection); }
            }
        }
        finally { Release(enumerator); }
        return result.ToArray();
    }

    static string DefaultId(Enumerator enumerator, int flow, int role)
    {
        Device device = null;
        try
        {
            if (enumerator.GetDefaultAudioEndpoint(flow, role, out device) < 0) return null;
            string id;
            Check(device.GetId(out id));
            return id;
        }
        finally { Release(device); }
    }

    static Endpoint Find(string id, bool microphone)
    {
        foreach (var device in List())
            if (device.id == id && (!microphone || device.flow == 1)) return device;
        throw new InvalidOperationException("Audio device is unavailable.");
    }

    public static void SetDefault(string id)
    {
        Endpoint endpoint = Find(id, false);
        var enumerator = (Enumerator)new EnumeratorObject();
        var policy = (Policy)new PolicyObject();
        var previous = new string[3];
        int changed = 0;
        try
        {
            for (int role = 0; role < 3; role++) previous[role] = DefaultId(enumerator, endpoint.flow, role);
            for (int role = 0; role < 3; role++)
            {
                Check(policy.SetDefaultEndpoint(id, role));
                changed++;
            }
        }
        catch
        {
            for (int role = 0; role < changed; role++)
                if (previous[role] != null) policy.SetDefaultEndpoint(previous[role], role);
            throw;
        }
        finally { Release(policy); Release(enumerator); }
    }

    public static void SetMute(string id, bool muted)
    {
        Find(id, true);
        var enumerator = (Enumerator)new EnumeratorObject();
        Device device = null;
        Volume volume = null;
        try
        {
            Check(enumerator.GetDevice(id, out device));
            volume = ActivateVolume(device);
            Guid context = Guid.Empty;
            Check(volume.SetMute(muted, ref context));
        }
        finally { Release(volume); Release(device); Release(enumerator); }
    }

    static Volume ActivateVolume(Device device)
    {
        Guid guid = typeof(Volume).GUID;
        object instance;
        Check(device.Activate(ref guid, 23, IntPtr.Zero, out instance));
        return (Volume)instance;
    }

    static bool Muted(Device device)
    {
        Volume volume = null;
        try
        {
            volume = ActivateVolume(device);
            bool muted;
            Check(volume.GetMute(out muted));
            return muted;
        }
        finally { Release(volume); }
    }

    static string Name(Device device)
    {
        Properties properties = null;
        Variant value = new Variant();
        try
        {
            Check(device.OpenPropertyStore(0, out properties));
            Key key = new Key { format = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), id = 14 };
            Check(properties.GetValue(ref key, out value));
            return value.type == 31 ? Marshal.PtrToStringUni(value.pointer) : "Audio";
        }
        finally { PropVariantClear(ref value); Release(properties); }
    }

    [StructLayout(LayoutKind.Sequential)] struct Key { public Guid format; public uint id; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] struct Variant
    {
        [FieldOffset(0)] public ushort type;
        [FieldOffset(8)] public IntPtr pointer;
    }
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref Variant value);
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class EnumeratorObject {}
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Enumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out Collection collection);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out Device device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out Device device);
    }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Collection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out Device device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Device
    {
        [PreserveSig] int Activate(ref Guid id, int context, IntPtr activation, [MarshalAs(UnmanagedType.IUnknown)] out object result);
        [PreserveSig] int OpenPropertyStore(int mode, out Properties properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Properties
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out Key key);
        [PreserveSig] int GetValue(ref Key key, out Variant value);
    }
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Volume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr value);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr value);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float value, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float value, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float value);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float value);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float value, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float value, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float value);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float value);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
    }
    // Windows desktop audio policy interface. Keep all preceding slots in their native order.
    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyObject {}
    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Policy
    {
        void GetMixFormat();
        void GetDeviceFormat();
        void ResetDeviceFormat();
        void SetDeviceFormat();
        void GetProcessingPeriod();
        void SetProcessingPeriod();
        void GetShareMode();
        void SetShareMode();
        void GetPropertyValue();
        void SetPropertyValue();
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    }
}
