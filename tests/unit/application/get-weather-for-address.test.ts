import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createGetWeatherForAddress } from '../../../src/application/get-weather-for-address.ts'
import { isErr, isOk } from '../../../src/domain/result.ts'
import { aForecast, anAddress, aPlace, someCoordinates } from '../../support/fixtures.ts'
import { failed, fakeForecast, fakeGeocoding, okFetched, unreachable } from '../../support/fake-ports.ts'

describe('getWeatherForAddress', () => {
  it('enchaine geocodage puis meteo et renvoie un rapport complet', async () => {
    const place = aPlace()
    const forecast = aForecast()
    const geocoding = fakeGeocoding(okFetched(place))
    const weather = fakeForecast(okFetched(forecast))

    const result = await createGetWeatherForAddress({ geocoding, forecast: weather })(anAddress('Ales'))

    assert.equal(isOk(result), true)
    if (!isOk(result)) return
    assert.deepEqual(result.value, {
      address: 'Ales',
      place,
      forecast,
      degraded: false,
      sources: { geocoding: 'live', forecast: 'live' },
    })
  })

  it('transmet au service meteo les coordonnees issues du geocodage', async () => {
    const geocoding = fakeGeocoding(okFetched(aPlace()))
    const weather = fakeForecast(okFetched(aForecast()))

    await createGetWeatherForAddress({ geocoding, forecast: weather })(anAddress('Ales'))

    assert.deepEqual(geocoding.calls, ['Ales'])
    assert.deepEqual(weather.calls, [someCoordinates])
  })

  it('n appelle pas le service meteo si le lieu est introuvable', async () => {
    const geocoding = fakeGeocoding(failed({ kind: 'place-not-found', address: 'Atlantide' }))
    const weather = fakeForecast(okFetched(aForecast()))

    const result = await createGetWeatherForAddress({ geocoding, forecast: weather })(anAddress('Atlantide'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.deepEqual(result.error, { kind: 'place-not-found', address: 'Atlantide' })
    assert.deepEqual(weather.calls, [], 'le service meteo ne doit pas etre sollicite')
  })

  it('n appelle pas le service meteo si le geocodage est en panne', async () => {
    const geocoding = fakeGeocoding(failed(unreachable('geocoding')))
    const weather = fakeForecast(okFetched(aForecast()))

    const result = await createGetWeatherForAddress({ geocoding, forecast: weather })(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.deepEqual(result.error, unreachable('geocoding'))
    assert.deepEqual(weather.calls, [])
  })

  it('conserve le lieu resolu quand seule la meteo est indisponible', async () => {
    const place = aPlace()
    const geocoding = fakeGeocoding(okFetched(place))
    const weather = fakeForecast(failed(unreachable('forecast')))

    const result = await createGetWeatherForAddress({ geocoding, forecast: weather })(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (!isErr(result)) return
    assert.deepEqual(result.error, {
      kind: 'forecast-unavailable',
      place,
      geocoding: 'live',
      cause: unreachable('forecast'),
    })
  })

  it('signale un rapport degrade quand le geocodage vient du cache perime', async () => {
    const geocoding = fakeGeocoding(okFetched(aPlace(), 'stale'))
    const weather = fakeForecast(okFetched(aForecast()))

    const result = await createGetWeatherForAddress({ geocoding, forecast: weather })(anAddress('Ales'))

    assert.equal(isOk(result), true)
    if (!isOk(result)) return
    assert.equal(result.value.degraded, true)
    assert.deepEqual(result.value.sources, { geocoding: 'stale', forecast: 'live' })
  })

  it('signale un rapport degrade quand la meteo vient du cache perime', async () => {
    const geocoding = fakeGeocoding(okFetched(aPlace()))
    const weather = fakeForecast(okFetched(aForecast(), 'stale'))

    const result = await createGetWeatherForAddress({ geocoding, forecast: weather })(anAddress('Ales'))

    assert.equal(isOk(result), true)
    if (!isOk(result)) return
    assert.equal(result.value.degraded, true)
    assert.deepEqual(result.value.sources, { geocoding: 'live', forecast: 'stale' })
  })

  it('ne considere pas un cache encore frais comme degrade', async () => {
    const geocoding = fakeGeocoding(okFetched(aPlace(), 'cached'))
    const weather = fakeForecast(okFetched(aForecast(), 'cached'))

    const result = await createGetWeatherForAddress({ geocoding, forecast: weather })(anAddress('Ales'))

    assert.equal(isOk(result), true)
    if (!isOk(result)) return
    assert.equal(result.value.degraded, false)
    assert.deepEqual(result.value.sources, { geocoding: 'cached', forecast: 'cached' })
  })
})
