export default function OceanBaseOptions({ settings }) {
  return (
    <div className="w-full flex flex-col gap-y-4">
      <div className="w-full flex items-center gap-4">
        <div className="flex flex-col w-60">
          <label className="text-white text-sm font-semibold block mb-4">
            OceanBase Host
          </label>
          <input
            type="text"
            name="OceanBaseHost"
            className="bg-zinc-900 text-white placeholder:text-white/20 text-sm rounded-lg focus:border-white block w-full p-2.5"
            placeholder="localhost"
            defaultValue={settings?.OceanBaseHost}
            required={true}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col w-60">
          <label className="text-white text-sm font-semibold block mb-4">
            OceanBase Port
          </label>
          <input
            type="text"
            name="OceanBasePort"
            className="bg-zinc-900 text-white placeholder:text-white/20 text-sm rounded-lg focus:border-white block w-full p-2.5"
            placeholder="2881"
            defaultValue={settings?.OceanBasePort}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        
        <div className="flex flex-col w-60">
          <label className="text-white text-sm font-semibold block mb-4">
            OceanBase Username
          </label>
          <input
            type="text"
            name="OceanBaseUser"
            className="bg-zinc-900 text-white placeholder:text-white/20 text-sm rounded-lg focus:border-white block w-full p-2.5"
            placeholder="root"
            defaultValue={settings?.OceanBaseUser}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col w-60">
          <label className="text-white text-sm font-semibold block mb-4">
            OceanBase Password
          </label>
          <input
            type="password"
            name="OceanBasePassword"
            className="bg-zinc-900 text-white placeholder:text-white/20 text-sm rounded-lg focus:border-white block w-full p-2.5"
            placeholder="password"
            defaultValue={settings?.OceanBasePassword ? "*".repeat(20) : ""}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col w-60">
          <label className="text-white text-sm font-semibold block mb-4">
            OceanBase DataBase
          </label>
          <input
            type="text"
            name="OceanBaseDataBase"
            className="bg-zinc-900 text-white placeholder:text-white/20 text-sm rounded-lg focus:border-white block w-full p-2.5"
            placeholder="test"
            defaultValue={settings?.OceanBaseDataBase}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
