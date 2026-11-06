import postgres from 'postgres'
2
3const connectionString = process.env.DATABASE_URL
4const sql = postgres(connectionString)
5
6export default sql