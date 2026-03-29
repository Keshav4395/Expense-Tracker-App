import React, { useState } from 'react';
import { Target, ArrowRight, ArrowLeft } from 'lucide-react';

const Step3Savings = ({ userData, onNext, onBack }) => {
  const [targetSavings, setTargetSavings] = useState('');
  const [savingsPercentage, setSavingsPercentage] = useState(30);

  const calculateAmount = (percentage) => {
    return Math.floor((userData.monthlyIncome * percentage) / 100);
  };

  const handlePercentageChange = (percentage) => {
    setSavingsPercentage(percentage);
    setTargetSavings(calculateAmount(percentage));
  };

  const handleNext = () => {
    if (targetSavings && parseFloat(targetSavings) > 0) {
      const dailyBudget = Math.floor((userData.monthlyIncome - parseFloat(targetSavings)) / 30);
      onNext({ 
        targetSavings: parseFloat(targetSavings),
        savingsPercentage,
        dailyBudget
      });
    } else {
      alert('Please enter a valid savings goal');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            Savings Goal
          </h1>
          <p className="text-gray-600 text-lg">
            Step 3 of 5 • How much do you want to save?
          </p>
          <div className="w-full bg-gray-200 h-2 rounded-full mt-6">
            <div className="bg-purple-600 h-2 rounded-full" style={{ width: '60%' }} />
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">
            Monthly Savings Target
          </h2>
          
          {/* Quick Selection */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[20, 30, 40, 50].map(percent => (
              <button
                key={percent}
                onClick={() => handlePercentageChange(percent)}
                className={`p-4 rounded-xl border-2 transition-all ${
                  savingsPercentage === percent
                    ? 'border-purple-600 bg-purple-50'
                    : 'border-gray-200 hover:border-purple-300'
                }`}
              >
                <div className="text-2xl font-bold text-purple-600">{percent}%</div>
                <div className="text-sm text-gray-600">₹{calculateAmount(percent).toLocaleString()}</div>
              </button>
            ))}
          </div>

          {/* Custom Amount */}
          <div className="relative mb-6">
            <Target className="absolute left-4 top-4 w-6 h-6 text-gray-400" />
            <input
              type="number"
              value={targetSavings}
              onChange={(e) => setTargetSavings(e.target.value)}
              className="w-full pl-14 pr-4 py-4 text-2xl font-semibold border-2 border-gray-300 rounded-xl focus:border-purple-500 focus:outline-none"
              placeholder="15000"
            />
            <span className="absolute right-4 top-4 text-gray-500 text-xl">₹ / month</span>
          </div>

          {/* Budget Calculation */}
          {targetSavings && (
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-6 rounded-xl border-2 border-green-200">
              <h3 className="font-semibold text-gray-800 mb-3">Your Budget Breakdown:</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Monthly Income:</span>
                  <span className="font-semibold">₹{userData.monthlyIncome.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Target Savings:</span>
                  <span className="font-semibold text-green-600">₹{parseFloat(targetSavings).toLocaleString()}</span>
                </div>
                <div className="border-t border-green-300 pt-2 mt-2"></div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Available to Spend:</span>
                  <span className="font-semibold">₹{(userData.monthlyIncome - parseFloat(targetSavings)).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Daily Budget:</span>
                  <span className="font-semibold text-purple-600 text-lg">
                    ₹{Math.floor((userData.monthlyIncome - parseFloat(targetSavings)) / 30).toLocaleString()} / day
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={onBack}
            className="flex-1 bg-gray-200 text-gray-700 py-4 rounded-xl font-semibold text-lg hover:bg-gray-300 transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <button
            onClick={handleNext}
            disabled={!targetSavings}
            className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-xl font-semibold text-lg hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            Continue
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Step3Savings;