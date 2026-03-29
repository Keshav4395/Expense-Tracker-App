import React, { useState } from 'react';
import { DollarSign, ArrowRight, ArrowLeft } from 'lucide-react';

const Step2Income = ({ userData, onNext, onBack }) => {
  const [monthlyIncome, setMonthlyIncome] = useState('');

  const handleNext = () => {
    if (monthlyIncome && parseFloat(monthlyIncome) > 0) {
      onNext({ monthlyIncome: parseFloat(monthlyIncome) });
    } else {
      alert('Please enter a valid monthly income');
    }
  };

  const incomeLabel = userData.userType === 'student' 
    ? 'Monthly Allowance/Stipend' 
    : 'Monthly Salary';

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            Your Income
          </h1>
          <p className="text-gray-600 text-lg">
            Step 2 of 5 • This helps us calculate your budget
          </p>
          <div className="w-full bg-gray-200 h-2 rounded-full mt-6">
            <div className="bg-purple-600 h-2 rounded-full" style={{ width: '40%' }} />
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">
            What's your {incomeLabel.toLowerCase()}?
          </h2>
          
          <div className="relative">
            <DollarSign className="absolute left-4 top-4 w-6 h-6 text-gray-400" />
            <input
              type="number"
              value={monthlyIncome}
              onChange={(e) => setMonthlyIncome(e.target.value)}
              className="w-full pl-14 pr-4 py-4 text-2xl font-semibold border-2 border-gray-300 rounded-xl focus:border-purple-500 focus:outline-none"
              placeholder="50000"
            />
            <span className="absolute right-4 top-4 text-gray-500 text-xl">₹ / month</span>
          </div>

          <p className="text-gray-500 text-sm mt-4">
            💡 This information is private and used only for budget calculations
          </p>
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
            disabled={!monthlyIncome}
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

export default Step2Income;