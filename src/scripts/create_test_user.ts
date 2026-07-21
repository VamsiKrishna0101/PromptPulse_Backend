import bcrypt from 'bcryptjs'
import prisma from '../../src/lib/prisma'

async function createTestUser() {
    const email = 'vamsi.krishna@refractconsulting.com'
    const password = 'Password123'
    
    console.log(`Creating user: ${email}...`)
    
    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } })
    
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)
    
    if (existing) {
        console.log('User already exists, updating password and setting as verified...')
        await prisma.user.update({
            where: { email },
            data: {
                password: hashedPassword,
                is_verified: true
            }
        })
        console.log('User updated.')
    } else {
        console.log('Creating new user...')
        await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                account_type: 'SINGLE',
                is_verified: true
            }
        })
        console.log('User created.')
    }
}

createTestUser()
    .then(() => {
        console.log('Done.')
        process.exit(0)
    })
    .catch((error) => {
        console.error('Error creating user:', error)
        process.exit(1)
    })
