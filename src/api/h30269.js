import axios from 'axios'

const H30269_API_URL = '/api/h30269'

export async function getH30269() {
  const { data } = await axios.get(H30269_API_URL, {
    headers: {
      Accept: 'application/json',
    },
  })

  return data
}
