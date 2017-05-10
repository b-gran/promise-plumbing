const PP = require('./index')
const R = require('ramda')

expect.extend({
  toBeWithinError (received, expected, error) {
    const pass = Math.abs(received - expected) <= error
    return {
      message: () => `expected ${received} to${_not(pass)} be within ${error} of ${expected}`,
      pass: pass
    }
  }
})

const _pow = R.curry(Math.pow)

describe('wrap', () => {
  const value = {}
  const primitive = PP.wrap(() => value)
  const promise = PP.wrap(() => Promise.resolve(value))

  it('returns a Promise-returning Function', () => {
    expect(primitive).toBeInstanceOf(Function)
    expect(primitive()).toBeInstanceOf(Promise)
    expect(promise).toBeInstanceOf(Function)
    expect(promise()).toBeInstanceOf(Promise)
  })

  it('ultimately resolves to the original value', () => Promise.all([
    primitive().then(result => expect(result).toBe(value)),
    promise().then(result => expect(result).toBe(value))
  ]))

  it('handles synchronous throwing', () => {
    const err = new Error('failure')
    expect(PP.wrap(() => {
      throw err
    })()).rejects.toBe(err)
  })
})

describe('branch', () => {
  const value = {}

  it('is a variadic function-returning function', () => {
    expect(PP.branch).toBeInstanceOf(Function)
    expect(PP.branch.length).toBe(0)
    expect(PP.branch(R.identity)).toBeInstanceOf(Function)
  })

  it('passes the initial value to each branching function', () =>
    PP.branch(
      x => expect(x).toBe(value),
      x => expect(x).toBe(value)
    )(value)
  )

  it('resolves the initial value if it is a Promise', () =>
    PP.branch(R.identity)(
      new Promise(resolve => setTimeout(() => resolve(value), 10))
    ).then(([ x ]) => expect(x).toBe(value))
  )

  it('has an array of fulfillment values as its ultimate fulfillment value', () =>
    PP.branch(
      x => new Promise(resolve => resolve(x + 1)),
      x => Promise.resolve(x * 2),
      x => x - 3
    )(Promise.resolve(5)).then(result => expect(result).toEqual([ 6, 10, 2 ])),
  )
})

describe('whilst', () => {
  it('does synchronous operation while the synchronous test returns true', () => {
    return PP.whilst(
      x => x.length < 5,
      x => x.length + 1
    ).then(result => expect(result).toEqual([ 1, 2, 3, 4, 5 ]))
  })

  it('does asynchronous operation while the asynchronous test returns true', () => {
    return PP.whilst(
      x => PP.delay(100).then(R.always(x.length < 5)),
      x => PP.delay(100).then(R.always(x.length + 1))
    ).then(result => expect(result).toEqual([ 1, 2, 3, 4, 5 ]))
  })

  it('exits immediately if the operation rejects', () => {
    let count = 0
    return PP.whilst(
      R.always(true),
      x => x.length > 2
        ? Promise.reject(count)
        : (count++, x.length + 1)
    ).catch(finalCount => expect(finalCount).toBe(3))
  })

  it('exits immediately if the test rejects', () => {
    let count = 0
    return PP.whilst(
      x => x.length < 3
        ? (count++, true)
        : Promise.reject(count),
      x => x.length + 1
    ).catch(finalCount => expect(finalCount).toBe(3))
  })
})

describe('doWhilst', () => {
  it('calls the operation exactly once', () =>
    PP.doWhilst(
      () => 'something',
      R.F
    ).then(result => expect(result).toEqual([ 'something' ]))
  )

  it('calls the operation twice', () =>
    PP.doWhilst(
      R.length,
      R.compose(R.lt(R.__, 2), R.length)
    ).then(result => expect(result).toEqual([ 0, 1 ]))
  )
})

describe('pipe', () => {
  it('passes the result of each step to the next step', () =>
    PP.pipe(
      x => x + 1,
      x => PP.delay(20).then(R.always(x * 2)),
      x => x - 3,
    )(5).then(result => expect(result).toBe(9))
  )

  it('passes all arguments to the first pipe step', () =>
    PP.pipe(
      (x, y) => x - y
    )(5, 2).then(result => expect(result).toBe(3))
  )

  it('resolves any Promises in the arguments', () =>
    PP.pipe(
      (x, y) => x + y,
      x => PP.delay(20).then(R.always(x * 2)),
      x => x - 3
    )(
      PP.delay(20).then(R.always(5)),
      PP.delay(20).then(R.always(2))
    ).then(result => expect(result).toBe(11))
  )

  it('exits after the first failed Promise', () =>
    expect(PP.pipe(
      () => true,
      () => Promise.reject('failure'),
      () => expect(false)
    )()).rejects.toBe('failure')
  )
})

describe('retry', () => {
  it('throws if times is a non-number', () => {
    expect(() => PP.retry()).toThrow()
    expect(() => PP.retry(null, R.identity)).toThrow()
    expect(() => PP.retry('5', R.identity)).toThrow()
  })

  it('attempts the operation times times before rejecting', () => {
    let count = 0
    return PP.retry(
      { times: 5 },
      x => (count++, Promise.reject('failure'))
    )
      .then(() => expect(false))
      .catch(err => {
        expect(count).toBe(5)
        expect(err).toBe('failure')
      })
  })

  it('stops running the task after it succeeds', () => {
    const succeedOnThirdTry = (() => {
      let failures = 0
      return () => (++failures) < 2
        ? Promise.reject('failure')
        : Promise.resolve('success')
    })()

    let count = 0
    return PP.retry(
      { times: 5 },
      () => (count++, succeedOnThirdTry())
    )
      .catch(() => expect(false))
      .then(result => {
        expect(result).toBe('success')
        expect(count).toBe(2)
      })
  })

  it('delays based on the interval function', () => {
    // Exponential backoff function
    const interval = R.compose(R.multiply(15), _pow(2))
    const times = 7
    const expectedTotalDelay = R.sum(R.map(
      R.compose(interval, R.add(1)),
      R.times(R.identity, times - 1)
    ))

    const now = Date.now()

    return PP.retry(
      { times, interval },
      x => Promise.reject('failure')
    )
      .then(() => expect(false))
      .catch(err => {
        expect(Date.now() - now).toBeWithinError(expectedTotalDelay, 50)
        expect(err).toBe('failure')
      })
  })

  it('works with synchronous tasks', () => {
    const _fail = msg => { throw new Error(msg) }
    let count = 0
    return PP.retry(
      { times: 5 },
      x => (count++, _fail('failure'))
    )
      .then(() => expect(false))
      .catch(err => {
        expect(count).toBe(5)
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('failure')
      })
  })
})

const _not = R.ifElse(R.identity, R.always(' not'), R.always(''))

describe('delay', () => {
  it('waits for the specified duration', () => {
    const start = Date.now()
    const duration = 500
    return PP.delay(duration)
      .then(() => expect(Date.now() - start).toBeWithinError(duration, 10))
  })
})

const _l = console.log.bind(console)
