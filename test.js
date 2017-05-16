const P = require('./index')
const R = require('ramda')

// Fail a test
const fail = () => expect(false).toBeTruthy()

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
  const primitive = P.wrap(() => value)
  const promise = P.wrap(() => Promise.resolve(value))

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
    return expect(P.wrap(() => { throw err })())
      .rejects.toBe(err)
  })
})

describe('branch', () => {
  const value = {}

  it('is a variadic function-returning function', () => {
    expect(P.branch).toBeInstanceOf(Function)
    expect(P.branch.length).toBe(0)
    expect(P.branch(R.identity)).toBeInstanceOf(Function)
  })

  it('passes the initial value to each branching function', () =>
    P.branch(
      x => expect(x).toBe(value),
      x => expect(x).toBe(value)
    )(value)
  )

  it('resolves the initial value if it is a Promise', () =>
    P.branch(R.identity)(
      new Promise(resolve => setTimeout(() => resolve(value), 10))
    ).then(([x]) => expect(x).toBe(value))
  )

  it('has an array of fulfillment values as its ultimate fulfillment value', () =>
    P.branch(
      x => new Promise(resolve => resolve(x + 1)),
      x => Promise.resolve(x * 2),
      x => x - 3
    )(Promise.resolve(5))
      .then(result => expect(result).toEqual([6, 10, 2])),
  )
})

describe('whilst', () => {
  const lengthLt5 = R.compose(R.gt(5), R.length)
  const lengthPlus1 = R.compose(R.add(1), R.length)

  it('does synchronous operation while the synchronous test returns true', () => {
    return P.whilst(lengthLt5, lengthPlus1)
      .then(result => expect(result).toEqual([1, 2, 3, 4, 5]))
  })

  it('does asynchronous operation while the asynchronous test returns true', () => {
    return P.whilst(
      x => P.delay(100).then(R.always(lengthLt5(x))),
      x => P.delay(100).then(R.always(lengthPlus1(x)))
    ).then(result => expect(result).toEqual([1, 2, 3, 4, 5]))
  })

  const succeedWhileLengthLt3 = R.either(
    R.compose(R.lt(R.__, 3), R.length),
    R.compose(P.bindOwn('reject', Promise), R.length)
  )

  it('exits immediately if the operation rejects', () => {
    const mockTest = jest.fn(R.T)
    const succeedFirstThree = jest.fn(succeedWhileLengthLt3)
    return P.whilst(mockTest, succeedFirstThree)
      .then(fail)
      .catch(finalCount => {
        expect(finalCount).toBe(3)
        expect(mockTest).toHaveBeenCalledTimes(4)
        expect(succeedFirstThree).toHaveBeenCalledTimes(4)
      })
  })

  it('exits immediately if the test rejects', () => {
    const succeedFirstThree = jest.fn(succeedWhileLengthLt3)
    const mockOperation = jest.fn()
    return P.whilst(succeedFirstThree, mockOperation)
      .then(fail)
      .catch(finalCount => {
        expect(finalCount).toBe(3)
        expect(succeedFirstThree).toHaveBeenCalledTimes(4)
        expect(mockOperation).toHaveBeenCalledTimes(3)
      })
  })
})

describe('doWhilst', () => {
  it('calls the operation exactly once', () =>
    P.doWhilst(() => 'something', R.F)
      .then(result => expect(result).toEqual(['something']))
  )

  it('calls the operation twice', () =>
    P.doWhilst(
      R.length,
      R.compose(R.lt(R.__, 2), R.length)
    ).then(result => expect(result).toEqual([0, 1]))
  )
})

describe('pipe', () => {
  it('passes the result of each step to the next step', () =>
    P.pipe(
      x => x + 1,
      x => P.delay(20).then(R.always(x * 2)),
      x => x - 3
    )(5).then(result => expect(result).toBe(9))
  )

  it('passes all arguments to the first pipe step', () =>
    P.pipe(
      (x, y) => x - y
    )(5, 2).then(result => expect(result).toBe(3))
  )

  it('resolves any Promises in the arguments', () =>
    P.pipe(
      (x, y) => x + y,
      x => P.delay(20).then(R.always(x * 2)),
      x => x - 3
    )(
      P.delay(20).then(R.always(5)),
      P.delay(20).then(R.always(2))
    ).then(result => expect(result).toBe(11))
  )

  it('exits after the first failed Promise', () =>
    expect(P.pipe(
      R.T,
      () => Promise.reject('failure'),
      fail
    )()).rejects.toBe('failure')
  )
})

describe('retry', () => {
  it('throws if times is a non-number', () => {
    expect(() => P.retry()).toThrow()
    expect(() => P.retry(null, R.identity)).toThrow()
    expect(() => P.retry('5', R.identity)).toThrow()
  })

  it('attempts the operation times times before rejecting', () => {
    const alwaysReject = jest.fn(R.always(Promise.reject('failure')))
    return P.retry(
      { times: 5 },
      alwaysReject
    ).then(fail).catch(err => {
      expect(alwaysReject).toHaveBeenCalledTimes(5)
      expect(err).toBe('failure')
    })
  })

  it('stops running the task after it succeeds', () => {
    const succeedOnThirdTry = jest.fn((() => {
      let failures = 0
      return () => (++failures) < 2
        ? Promise.reject('failure')
        : Promise.resolve('success')
    })())

    return P.retry(
      { times: 5 },
      succeedOnThirdTry
    ).then(result => {
      expect(result).toBe('success')
      expect(succeedOnThirdTry).toHaveBeenCalledTimes(2)
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

    return P.retry(
      { times, interval },
      x => Promise.reject('failure')
    ).then(fail).catch(err => {
      expect(Date.now() - now).toBeWithinError(expectedTotalDelay, 50)
      expect(err).toBe('failure')
    })
  })

  it('works with synchronous tasks', () => {
    const alwaysThrow = jest.fn(msg => { throw new Error(msg) })
    return P.retry(
      { times: 5 },
      x => alwaysThrow('failure')
    ).then(fail).catch(err => {
      expect(alwaysThrow).toHaveBeenCalledTimes(5)
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
    return P.delay(duration)
      .then(() => expect(Date.now() - start).toBeWithinError(duration, 10))
  })
})

describe('bindOwn', () => {
  const value = {}
  const func = function () { return this.bar }
  const object = {
    bar: value,
    foo: func
  }

  it('is curried', () =>
    expect(P.bindOwn('foo')(object)()).toBe(value)
  )

  it('throws if the property isn\'t a string, number or Symbol', () => {
    expect(() => P.bindOwn(undefined, {})).toThrow()
    expect(() => P.bindOwn({}, {})).toThrow()
  })

  it('throws if the object is nil', () => {
    expect(() => P.bindOwn('foo', null)).toThrow()
    expect(() => P.bindOwn('foo', undefined)).toThrow()
  })

  it('throws if the property is a non-function', () =>
    expect(() => P.bindOwn('foo', { foo: 5 })).toThrow()
  )

  it('binds the property to the object', () => {
    const bound = P.bindOwn('foo', object)
    expect(bound()).toBe(value)
  })
})

describe('then', () => {
  it('resolves the promise using the handler', () => {
    return expect(
      P.$then(R.concat('foo'))(Promise.resolve('bar'))
    ).resolves.toBe('foobar')
  })

  it('handles non-promises', () => {
    return expect(
      P.$then(R.concat('foo'))('bar')
    ).resolves.toBe('foobar')
  })

  it('throws if the handler is a non-function', () =>
    expect(() => P.$then('foo')).toThrowError(/must be a function/)
  )
})

describe('catch', () => {
  it('handles the promise rejection using the handler', () => {
    return expect(
      P.$catch(R.concat('foo'))(Promise.reject('bar'))
    ).resolves.toBe('foobar')
  })

  it('handles non-promises', () => {
    return expect(P.$catch(fail)('foo')).resolves.toBe('foo')
  })

  it('throws if the handler is a non-function', () =>
    expect(() => P.$catch('foo')).toThrowError(/must be a function/)
  )
})

const _l = console.log.bind(console)
