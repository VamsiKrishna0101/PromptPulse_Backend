import { getFilterOptions } from './src/features/dashboard/dashboard_service'

async function run() {
    try {
        const res = await getFilterOptions('6fc22d1a-6271-48ae-b3d7-1d59157f7a1f')
        console.log("Success:", res)
    } catch (e) {
        console.error("Error:", e)
    }
}
run()
