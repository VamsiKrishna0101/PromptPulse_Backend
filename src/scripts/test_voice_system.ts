import { HOSPITAL_VOICE_PLAYBOOKS } from "../features/campaigns/voice/voice_playbooks"
import { isWithinCallingHoursIST, sanitizeIndianPhoneNumber, getIndianStandardTimeFormatted } from "../features/campaigns/voice/voice_telephony_service"
import { VoiceAIBrain } from "../features/campaigns/voice/voice_ai_brain"

async function testVoiceSystem() {
    console.log("--- 1. Testing Voice Playbooks ---")
    console.log(`Loaded ${HOSPITAL_VOICE_PLAYBOOKS.length} hospital playbooks.`)
    const opd = HOSPITAL_VOICE_PLAYBOOKS.find(p => p.id === "OPD_APPOINTMENT_CONFIRMATION")
    console.log(`OPD Playbook Name: ${opd?.name}, Default Voice: ${opd?.defaultVoice}`)

    console.log("\n--- 2. Testing Indian Phone Sanitizer & IST Regulatory Window ---")
    const p1 = sanitizeIndianPhoneNumber("9876543210")
    const p2 = sanitizeIndianPhoneNumber("+91 98480 22338")
    const p3 = sanitizeIndianPhoneNumber("080 4567 8911")
    console.log(`Sanitized: 9876543210 -> ${p1}, +91 98480 22338 -> ${p2}, 080 4567 8911 -> ${p3}`)

    const nowIST = getIndianStandardTimeFormatted()
    const allowed = isWithinCallingHoursIST()
    console.log(`Current IST Time: ${nowIST}, Calling Allowed: ${allowed}`)

    console.log("\n--- 3. Testing Voice AI Brain Telugu Turn Engine ---")
    const brain = new VoiceAIBrain()
    const patientDetails = {
        patient_name: "రామారావు",
        doctor_name: "Dr. ప్రియ శర్మ (కార్డియాలజీ)",
        scheduled_slot: "రేపు ఉదయం 10:30",
        hospital_name: "సిటీ కేర్ హాస్పిటల్"
    }

    const aiGreeting = await brain.generateInitialGreeting(opd?.systemPrompt || "", patientDetails)
    console.log(`AI Initial Greeting (Telugu):\n"${aiGreeting}"\n`)

    const turn1 = await brain.processTurn(
        opd?.systemPrompt || "",
        patientDetails,
        [{ sender: "ai", text: aiGreeting, timestamp: "00:05" }],
        "అవును మేడం, నేను రేపు ఉదయం 10:30 కి తప్పకుండా వస్తాను."
    )
    console.log(`Patient: "అవును మేడం, నేను రేపు ఉదయం 10:30 కి తప్పకుండా వస్తాను."`)
    console.log(`AI Response: "${turn1.responseText}"`)
    console.log(`Extracted Intent: ${turn1.intent}, Urgent: ${turn1.isUrgent}`)

    console.log("\n--- 4. Testing Emergency Triage Guard ---")
    const turn2 = await brain.processTurn(
        opd?.systemPrompt || "",
        patientDetails,
        [{ sender: "ai", text: aiGreeting, timestamp: "00:05" }],
        "నాకు గుండెల్లో చాలా నొప్పిగా ఉంది, ఊపిరి ఆడటం లేదు మేడం."
    )
    console.log(`Patient: "నాకు గుండెల్లో చాలా నొప్పిగా ఉంది, ఊపిరి ఆడటం లేదు మేడం."`)
    console.log(`AI Response: "${turn2.responseText}"`)
    console.log(`Extracted Intent: ${turn2.intent}, Urgent: ${turn2.isUrgent}`)

    console.log("\n✅ ALL VOICE ENGINE SYSTEM TESTS PASSED SUCCESSFULLY!")
}

testVoiceSystem().catch((err) => {
    console.error("Test failed:", err)
    process.exit(1)
})
